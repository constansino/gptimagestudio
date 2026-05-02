package api

import (
	"fmt"
	"strings"

	"chatgpt2api/internal/imaging"
)

const (
	defaultImageModelV1 = "gpt-image-1"
	defaultImageModelV2 = "gpt-image-2"
)

type imageModelAlias struct {
	Alias string
	Size  string
}

var testedImageModelAliases = []imageModelAlias{
	{Alias: defaultImageModelV2 + "-" + imaging.DefaultGenerateSize, Size: imaging.DefaultGenerateSize},
	{Alias: defaultImageModelV2 + "-1536x1024", Size: "1536x1024"},
	{Alias: defaultImageModelV2 + "-1024x1536", Size: "1024x1536"},
	{Alias: defaultImageModelV2 + "-1248x1248(1:1)", Size: "1248x1248"},
	{Alias: defaultImageModelV2 + "-2880x2880(1:1)", Size: "2880x2880"},
	{Alias: defaultImageModelV2 + "-1536x1024(3:2)", Size: "1536x1024"},
	{Alias: defaultImageModelV2 + "-1024x1536(2:3)", Size: "1024x1536"},
	{Alias: defaultImageModelV2 + "-1440x1072(4:3)", Size: "1440x1072"},
	{Alias: defaultImageModelV2 + "-1072x1440(3:4)", Size: "1072x1440"},
	{Alias: defaultImageModelV2 + "-1664x928(16:9)", Size: "1664x928"},
	{Alias: defaultImageModelV2 + "-928x1664(9:16)", Size: "928x1664"},
	{Alias: defaultImageModelV2 + "-1904x816(21:9)", Size: "1904x816"},
	{Alias: defaultImageModelV2 + "-816x1904(9:21)", Size: "816x1904"},
	{Alias: defaultImageModelV2 + "-3264x2448(4:3)", Size: "3264x2448"},
	{Alias: defaultImageModelV2 + "-2448x3264(3:4)", Size: "2448x3264"},
	{Alias: defaultImageModelV2 + "-3456x2304(3:2)", Size: "3456x2304"},
	{Alias: defaultImageModelV2 + "-2304x3456(2:3)", Size: "2304x3456"},
	{Alias: defaultImageModelV2 + "-3840x2160(16:9)", Size: "3840x2160"},
	{Alias: defaultImageModelV2 + "-2160x3840(9:16)", Size: "2160x3840"},
	{Alias: defaultImageModelV2 + "-3808x1632(21:9)", Size: "3808x1632"},
	{Alias: defaultImageModelV2 + "-1632x3808(9:21)", Size: "1632x3808"},
}

type imageModelSpec struct {
	DisplayModel   string
	CanonicalModel string
	DefaultSize    string
}

func resolveImageModelSpec(requested, fallback string) imageModelSpec {
	model := strings.TrimSpace(requested)
	if model == "" {
		model = strings.TrimSpace(fallback)
	}
	if model == "" {
		model = defaultImageModelV2
	}

	normalized := strings.ToLower(model)
	switch normalized {
	case defaultImageModelV1:
		return imageModelSpec{
			DisplayModel:   defaultImageModelV1,
			CanonicalModel: defaultImageModelV1,
		}
	case defaultImageModelV2:
		return imageModelSpec{
			DisplayModel:   defaultImageModelV2,
			CanonicalModel: defaultImageModelV2,
		}
	}

	for _, item := range testedImageModelAliases {
		if normalized == strings.ToLower(item.Alias) {
			return imageModelSpec{
				DisplayModel:   item.Alias,
				CanonicalModel: defaultImageModelV2,
				DefaultSize:    item.Size,
			}
		}
	}

	return imageModelSpec{
		DisplayModel:   model,
		CanonicalModel: model,
	}
}

func resolveImageModelRequestSize(explicitSize string, spec imageModelSpec) string {
	size := strings.TrimSpace(explicitSize)
	if size != "" {
		return size
	}
	return spec.DefaultSize
}

func supportedImageModelIDs() []string {
	items := []string{defaultImageModelV1, defaultImageModelV2}
	for _, item := range testedImageModelAliases {
		items = append(items, item.Alias)
	}
	return items
}

func withRequestedImageOutput(prompt, size, quality, background string) string {
	fullPrompt := strings.TrimSpace(prompt)
	if size != "" && size != "auto" && size != imaging.DefaultGenerateSize {
		fullPrompt = fmt.Sprintf("The output image size must be %s. %s", size, fullPrompt)
	}
	switch strings.ToLower(strings.TrimSpace(quality)) {
	case "hd", "high":
		fullPrompt = fmt.Sprintf("Produce a high-quality, detailed result. %s", fullPrompt)
	}
	if strings.EqualFold(strings.TrimSpace(background), "transparent") {
		fullPrompt += " The output image must have a transparent background (PNG with alpha channel)."
	}
	return fullPrompt
}
