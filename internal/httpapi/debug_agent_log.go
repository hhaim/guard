package httpapi

import (
	"encoding/json"
	"os"
	"time"
)

const debugAgentLogPath = "/Users/hhaim/scratch/guard/.cursor/debug-099795.log"

func debugAgentLog(location, message, hypothesisID string, data map[string]any) {
	payload := map[string]any{
		"sessionId":    "099795",
		"location":     location,
		"message":      message,
		"hypothesisId": hypothesisID,
		"data":         data,
		"timestamp":    time.Now().UnixMilli(),
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	f, err := os.OpenFile(debugAgentLogPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	_, _ = f.Write(append(b, '\n'))
	_ = f.Close()
}
