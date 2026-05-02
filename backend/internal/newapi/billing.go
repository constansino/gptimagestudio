package newapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

const defaultQuotaPerUSD int64 = 500000

var (
	ErrBillingNotConfigured = errors.New("newapi billing database is not configured")
	ErrBillingUserNotFound  = errors.New("newapi user not found")
	ErrBillingUserDisabled  = errors.New("newapi user is disabled")
	ErrInsufficientQuota    = errors.New("newapi user quota is insufficient")
)

type BillingStore struct {
	dsn     string
	timeout time.Duration
}

type BillingUser struct {
	ID        int64
	Username  string
	Role      int
	Status    int
	Group     string
	Quota     int64
	UsedQuota int64
}

type ChargeRequest struct {
	UserID     int
	Username   string
	Model      string
	Content    string
	RequestID  string
	IP         string
	ImageCount int
	PriceUSD   float64
}

func NewBillingStore(dsn string, timeout time.Duration) *BillingStore {
	return &BillingStore{
		dsn:     strings.TrimSpace(dsn),
		timeout: timeout,
	}
}

func QuotaUnitsForUSD(priceUSD float64, quotaPerUSD int64) int64 {
	if priceUSD <= 0 {
		return 0
	}
	if quotaPerUSD <= 0 {
		quotaPerUSD = defaultQuotaPerUSD
	}
	return int64(math.Ceil(priceUSD * float64(quotaPerUSD)))
}

func (s *BillingStore) CheckBalanceForImages(ctx context.Context, userID int, imageCount int, priceUSD float64) (*BillingUser, int64, error) {
	if imageCount <= 0 {
		imageCount = 1
	}
	db, err := s.openDB()
	if err != nil {
		return nil, 0, err
	}
	defer db.Close()

	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	quotaPerUSD := s.readQuotaPerUSD(ctx, db)
	requiredQuota := QuotaUnitsForUSD(priceUSD, quotaPerUSD) * int64(imageCount)
	user, err := readBillingUser(ctx, db, userID, false)
	if err != nil {
		return nil, requiredQuota, err
	}
	if user.Status != 1 {
		return user, requiredQuota, ErrBillingUserDisabled
	}
	if requiredQuota > 0 && user.Quota < requiredQuota {
		return user, requiredQuota, ErrInsufficientQuota
	}
	return user, requiredQuota, nil
}

func (s *BillingStore) ChargeSuccessfulImages(ctx context.Context, req ChargeRequest) (*BillingUser, int64, error) {
	if req.ImageCount <= 0 || req.PriceUSD <= 0 {
		user, err := s.GetUser(ctx, req.UserID)
		return user, 0, err
	}
	db, err := s.openDB()
	if err != nil {
		return nil, 0, err
	}
	defer db.Close()

	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback()

	quotaPerUSD := s.readQuotaPerUSDTx(ctx, tx)
	chargeQuota := QuotaUnitsForUSD(req.PriceUSD, quotaPerUSD) * int64(req.ImageCount)
	user, err := readBillingUserTx(ctx, tx, req.UserID, true)
	if err != nil {
		return nil, chargeQuota, err
	}
	if user.Status != 1 {
		return user, chargeQuota, ErrBillingUserDisabled
	}
	if chargeQuota > 0 && user.Quota < chargeQuota {
		return user, chargeQuota, ErrInsufficientQuota
	}

	if chargeQuota > 0 {
		if _, err := tx.ExecContext(
			ctx,
			`update users set quota = quota - $1, used_quota = used_quota + $1, request_count = request_count + $2 where id = $3 and deleted_at is null`,
			chargeQuota,
			req.ImageCount,
			req.UserID,
		); err != nil {
			return nil, chargeQuota, err
		}
	}

	now := time.Now()
	createdAt := now.Unix()
	model := truncateForColumn(firstNonEmpty(req.Model, "gpt-image-2"), 64)
	username := truncateForColumn(firstNonEmpty(req.Username, user.Username), 64)
	group := strings.TrimSpace(user.Group)
	requestID := truncateForColumn(req.RequestID, 64)
	content := truncateText(firstNonEmpty(req.Content, "ChatGpt Image Studio image generation"), 1800)
	ip := truncateText(req.IP, 180)
	otherBytes, _ := json.Marshal(map[string]any{
		"source":        "chatgpt-image-studio",
		"image_count":   req.ImageCount,
		"price_usd":     req.PriceUSD,
		"quota_per_usd": quotaPerUSD,
	})
	if _, err := tx.ExecContext(
		ctx,
		`insert into logs (user_id, created_at, type, content, username, token_name, model_name, quota, prompt_tokens, completion_tokens, use_time, is_stream, token_id, "group", ip, other, request_id)
		 values ($1, $2, 2, $3, $4, $5, $6, $7, 0, $8, 0, false, 0, $9, $10, $11, $12)`,
		req.UserID,
		createdAt,
		content,
		username,
		"ChatGpt Image Studio",
		model,
		chargeQuota,
		req.ImageCount,
		group,
		ip,
		string(otherBytes),
		requestID,
	); err != nil {
		return nil, chargeQuota, err
	}

	quotaBucket := createdAt - createdAt%3600
	result, err := tx.ExecContext(
		ctx,
		`update quota_data set token_used = token_used + $1, count = count + $2, quota = quota + $3
		 where user_id = $4 and username = $5 and model_name = $6 and created_at = $7`,
		req.ImageCount,
		req.ImageCount,
		chargeQuota,
		req.UserID,
		username,
		model,
		quotaBucket,
	)
	if err != nil {
		return nil, chargeQuota, err
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		if _, err := tx.ExecContext(
			ctx,
			`insert into quota_data (user_id, username, model_name, created_at, token_used, count, quota)
			 values ($1, $2, $3, $4, $5, $6, $7)`,
			req.UserID,
			username,
			model,
			quotaBucket,
			req.ImageCount,
			req.ImageCount,
			chargeQuota,
		); err != nil {
			return nil, chargeQuota, err
		}
	}

	updated, err := readBillingUserTx(ctx, tx, req.UserID, false)
	if err != nil {
		return nil, chargeQuota, err
	}
	if err := tx.Commit(); err != nil {
		return nil, chargeQuota, err
	}
	return updated, chargeQuota, nil
}

func (s *BillingStore) GetUser(ctx context.Context, userID int) (*BillingUser, error) {
	db, err := s.openDB()
	if err != nil {
		return nil, err
	}
	defer db.Close()
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return readBillingUser(ctx, db, userID, false)
}

func (s *BillingStore) openDB() (*sql.DB, error) {
	if s == nil || strings.TrimSpace(s.dsn) == "" {
		return nil, ErrBillingNotConfigured
	}
	db, err := sql.Open("postgres", s.dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(1)
	db.SetConnMaxIdleTime(30 * time.Second)
	return db, nil
}

func (s *BillingStore) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	timeout := s.timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return context.WithTimeout(ctx, timeout)
}

func (s *BillingStore) readQuotaPerUSD(ctx context.Context, db *sql.DB) int64 {
	var raw string
	if err := db.QueryRowContext(ctx, `select value from options where key = 'QuotaPerUnit'`).Scan(&raw); err != nil {
		return defaultQuotaPerUSD
	}
	if parsed, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64); err == nil && parsed > 0 {
		return parsed
	}
	return defaultQuotaPerUSD
}

func (s *BillingStore) readQuotaPerUSDTx(ctx context.Context, tx *sql.Tx) int64 {
	var raw string
	if err := tx.QueryRowContext(ctx, `select value from options where key = 'QuotaPerUnit'`).Scan(&raw); err != nil {
		return defaultQuotaPerUSD
	}
	if parsed, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64); err == nil && parsed > 0 {
		return parsed
	}
	return defaultQuotaPerUSD
}

type userReader interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readBillingUser(ctx context.Context, db userReader, userID int, forUpdate bool) (*BillingUser, error) {
	return scanBillingUser(ctx, db, userID, forUpdate)
}

func readBillingUserTx(ctx context.Context, tx userReader, userID int, forUpdate bool) (*BillingUser, error) {
	return scanBillingUser(ctx, tx, userID, forUpdate)
}

func scanBillingUser(ctx context.Context, reader userReader, userID int, forUpdate bool) (*BillingUser, error) {
	query := `select id, coalesce(username, ''), coalesce(role, 1), coalesce(status, 1), coalesce("group", ''), coalesce(quota, 0), coalesce(used_quota, 0)
		from users where id = $1 and deleted_at is null`
	if forUpdate {
		query += ` for update`
	}
	user := &BillingUser{}
	err := reader.QueryRowContext(ctx, query, userID).Scan(
		&user.ID,
		&user.Username,
		&user.Role,
		&user.Status,
		&user.Group,
		&user.Quota,
		&user.UsedQuota,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrBillingUserNotFound
	}
	if err != nil {
		return nil, err
	}
	return user, nil
}

func truncateForColumn(value string, maxLen int) string {
	return truncateText(value, maxLen)
}

func truncateText(value string, maxLen int) string {
	text := strings.TrimSpace(value)
	if maxLen <= 0 || len([]rune(text)) <= maxLen {
		return text
	}
	runes := []rune(text)
	return string(runes[:maxLen])
}
