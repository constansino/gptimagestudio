package api

import "net/http"

func handleModels() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		models := supportedImageModelIDs()
		data := make([]map[string]any, 0, len(models))
		for index, model := range models {
			data = append(data, map[string]any{
				"id":       model,
				"object":   "model",
				"created":  1700000000 + index,
				"owned_by": "openai",
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"object": "list",
			"data":   data,
		})
	}
}
