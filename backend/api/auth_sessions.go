package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"chatgpt2api/internal/newapi"
)

const authSessionTTL = 7 * 24 * time.Hour

type authContextKey struct{}

type authSession struct {
	UserID      int    `json:"uid"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName,omitempty"`
	Email       string `json:"email,omitempty"`
	Role        int    `json:"role"`
	Admin       bool   `json:"admin"`
	Source      string `json:"source"`
	ExpiresAt   int64  `json:"exp"`
}

func (s *Server) requireAdminAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, ok := s.sessionFromRequest(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "authorization is invalid"})
			return
		}
		if !session.Admin {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "admin permission is required"})
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authContextKey{}, session)))
	})
}

func (s *Server) requireWorkspaceAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, ok := s.sessionFromRequest(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "authorization is invalid"})
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authContextKey{}, session)))
	})
}

func authSessionFromContext(ctx context.Context) *authSession {
	if ctx == nil {
		return nil
	}
	session, _ := ctx.Value(authContextKey{}).(*authSession)
	return session
}

func (s *Server) sessionFromRequest(r *http.Request) (*authSession, bool) {
	token := bearerFromRequest(r)
	if token == "" {
		return nil, false
	}
	if strings.TrimSpace(s.cfg.App.AuthKey) != "" && token == strings.TrimSpace(s.cfg.App.AuthKey) {
		return &authSession{
			UserID:   0,
			Username: "admin",
			Role:     100,
			Admin:    true,
			Source:   "app_key",
		}, true
	}
	session, err := s.verifySessionToken(token)
	if err != nil {
		return nil, false
	}
	return session, true
}

func (s *Server) issueSessionToken(session authSession) (string, error) {
	if session.ExpiresAt <= 0 {
		session.ExpiresAt = time.Now().Add(authSessionTTL).Unix()
	}
	payload, err := json.Marshal(session)
	if err != nil {
		return "", err
	}
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(s.sessionSecret()))
	_, _ = mac.Write([]byte(encodedPayload))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return "cigs.v1." + encodedPayload + "." + signature, nil
}

func (s *Server) verifySessionToken(token string) (*authSession, error) {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 4 || parts[0] != "cigs" || parts[1] != "v1" {
		return nil, errors.New("invalid session token")
	}
	payload := parts[2]
	signature := parts[3]
	mac := hmac.New(sha256.New, []byte(s.sessionSecret()))
	_, _ = mac.Write([]byte(payload))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(signature), []byte(expected)) {
		return nil, errors.New("invalid session signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil, err
	}
	var session authSession
	if err := json.Unmarshal(raw, &session); err != nil {
		return nil, err
	}
	if session.ExpiresAt > 0 && time.Now().Unix() > session.ExpiresAt {
		return nil, errors.New("session expired")
	}
	return &session, nil
}

func (s *Server) sessionSecret() string {
	secret := strings.TrimSpace(s.cfg.App.AuthKey)
	if secret == "" {
		secret = strings.TrimSpace(s.cfg.App.APIKey)
	}
	if secret == "" {
		secret = "chatgpt-image-studio-session"
	}
	return secret
}

func (s *Server) authResponse(session authSession, token string) map[string]any {
	return map[string]any{
		"ok":      true,
		"token":   token,
		"version": s.cfg.App.Version,
		"user":    session.publicPayload(),
		"billing": map[string]any{
			"enabled":       s.cfg.Billing.Enabled,
			"imagePriceUsd": s.cfg.Billing.ImagePriceUSD,
		},
	}
}

func (s authSession) publicPayload() map[string]any {
	return map[string]any{
		"id":          s.UserID,
		"username":    s.Username,
		"displayName": s.DisplayName,
		"email":       s.Email,
		"role":        s.Role,
		"isAdmin":     s.Admin,
		"source":      s.Source,
		"expiresAt":   s.ExpiresAt,
	}
}

func newAuthSessionFromNewAPIUser(user *newapi.User) authSession {
	if user == nil {
		return authSession{}
	}
	role := user.Role
	return authSession{
		UserID:      user.ID,
		Username:    strings.TrimSpace(user.Username),
		DisplayName: strings.TrimSpace(user.DisplayName),
		Email:       strings.TrimSpace(user.Email),
		Role:        role,
		Admin:       role >= 100,
		Source:      "newapi",
		ExpiresAt:   time.Now().Add(authSessionTTL).Unix(),
	}
}

func (s *Server) authenticateNewAPIUser(ctx context.Context, username, password string) (*newapi.User, error) {
	if strings.TrimSpace(s.cfg.NewAPI.BaseURL) == "" {
		return nil, newRequestError("newapi_not_configured", "NewAPI base_url is not configured")
	}
	timeout := time.Duration(max(10, s.cfg.NewAPI.RequestTimeout)) * time.Second
	client := newapi.New(
		s.cfg.NewAPI.BaseURL,
		"",
		"",
		"",
		0,
		"",
		timeout,
		s.cfg.SyncProxyURL(),
	)
	user, err := client.LoginWithPassword(ctx, username, password)
	if err != nil {
		return nil, newRequestError("newapi_login_failed", "用户名或密码错误")
	}
	if user.Status != 1 {
		return nil, newRequestError("newapi_user_disabled", "账号已被禁用")
	}
	return user, nil
}

func (s *Server) ensureImageBillingBalance(ctx context.Context, session *authSession, imageCount int) error {
	if !s.shouldBillSession(session) {
		return nil
	}
	store, err := s.newBillingStore()
	if err != nil {
		return s.billingRequestError(err)
	}
	_, _, err = store.CheckBalanceForImages(ctx, session.UserID, imageCount, s.cfg.Billing.ImagePriceUSD)
	if err != nil {
		return s.billingRequestError(err)
	}
	return nil
}

func (s *Server) chargeSuccessfulImages(ctx context.Context, session *authSession, model, prompt string, imageCount int, requestID string, r *http.Request) error {
	if !s.shouldBillSession(session) || imageCount <= 0 {
		return nil
	}
	store, err := s.newBillingStore()
	if err != nil {
		return s.billingRequestError(err)
	}
	_, _, err = store.ChargeSuccessfulImages(ctx, newapi.ChargeRequest{
		UserID:     session.UserID,
		Username:   session.Username,
		Model:      model,
		Content:    prompt,
		RequestID:  requestID,
		IP:         requestIP(r),
		ImageCount: imageCount,
		PriceUSD:   s.cfg.Billing.ImagePriceUSD,
	})
	if err != nil {
		return s.billingRequestError(err)
	}
	return nil
}

func (s *Server) shouldBillSession(session *authSession) bool {
	return session != nil &&
		!session.Admin &&
		strings.EqualFold(session.Source, "newapi") &&
		s.cfg.Billing.Enabled &&
		s.cfg.Billing.ImagePriceUSD > 0
}

func (s *Server) newBillingStore() (*newapi.BillingStore, error) {
	if strings.TrimSpace(s.cfg.Billing.NewAPISQLDSN) == "" {
		return nil, newapi.ErrBillingNotConfigured
	}
	timeout := time.Duration(max(10, s.cfg.NewAPI.RequestTimeout)) * time.Second
	return newapi.NewBillingStore(s.cfg.Billing.NewAPISQLDSN, timeout), nil
}

func (s *Server) billingRequestError(err error) error {
	switch {
	case errors.Is(err, newapi.ErrBillingNotConfigured):
		return newRequestError("billing_not_configured", "NewAPI 扣费数据库未配置")
	case errors.Is(err, newapi.ErrBillingUserNotFound):
		return newRequestError("billing_user_not_found", "NewAPI 用户不存在")
	case errors.Is(err, newapi.ErrBillingUserDisabled):
		return newRequestError("billing_user_disabled", "NewAPI 用户已被禁用")
	case errors.Is(err, newapi.ErrInsufficientQuota):
		return newRequestError("insufficient_quota", fmt.Sprintf("余额不足，本次至少需要 %.2f 美元", s.cfg.Billing.ImagePriceUSD))
	default:
		return newRequestError("billing_failed", "NewAPI 扣费失败："+err.Error())
	}
}

func requestIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	for _, header := range []string{"CF-Connecting-IP", "X-Real-IP", "X-Forwarded-For"} {
		value := strings.TrimSpace(r.Header.Get(header))
		if value == "" {
			continue
		}
		if header == "X-Forwarded-For" {
			value = strings.TrimSpace(strings.Split(value, ",")[0])
		}
		return value
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}
