// Command bank-go is a standalone in-memory FinSim participant bank.
package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
)

const maxBodyBytes = 1 << 20

// NewHandler wires the four finsim/v1 participant endpoints to the bank.
func NewHandler(bank *Bank) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /finsim/v1/institution/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"status": "UP", "contractVersions": []string{"finsim/v1"}})
	})
	mux.HandleFunc("GET /finsim/v1/institution/capabilities", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"institutionType": "BANK",
			"capabilities":    []string{"ACCOUNT_DEBIT", "ACCOUNT_CREDIT", "STATUS_QUERY"},
			"currencies":      []string{"USD"},
		})
	})
	mux.HandleFunc("POST /finsim/v1/payments", func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("Idempotency-Key")
		if len(key) < 8 || len(key) > 128 {
			writeResponse(w, errorResponse(400, "MISSING_IDEMPOTENCY_KEY",
				"The Idempotency-Key header is required (8 to 128 characters)."))
			return
		}
		var req PaymentLegRequest
		dec := json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil || dec.More() {
			writeResponse(w, errorResponse(400, "INVALID_REQUEST", "Request contains invalid or missing fields."))
			return
		}
		if _, err := dec.Token(); !errors.Is(err, io.EOF) {
			writeResponse(w, errorResponse(400, "INVALID_REQUEST", "Request contains invalid or missing fields."))
			return
		}
		writeResponse(w, bank.Apply(key, req))
	})
	mux.HandleFunc("GET /finsim/v1/payments/{transactionId}", func(w http.ResponseWriter, r *http.Request) {
		leg := r.URL.Query().Get("leg")
		if leg != "DEBIT" && leg != "CREDIT" {
			writeResponse(w, errorResponse(400, "INVALID_REQUEST", "Query parameter leg must be DEBIT or CREDIT."))
			return
		}
		result, ok := bank.Status(r.PathValue("transactionId"), leg)
		if !ok {
			writeResponse(w, errorResponse(404, "LEG_NOT_FOUND", "This institution has no record of that leg."))
			return
		}
		writeJSON(w, 200, result)
	})
	// Anything else gets the contract's error shape instead of Go's plain text.
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, pattern := mux.Handler(r)
		if pattern == "" {
			status, code := 404, "NOT_FOUND"
			msg := "Endpoint not found."
			if rec := probeMethods(mux, r); rec {
				status, code, msg = 405, "INVALID_REQUEST", "Method not allowed."
			}
			writeResponse(w, errorResponse(status, code, msg))
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// probeMethods reports whether the path matches a route under another method.
func probeMethods(mux *http.ServeMux, r *http.Request) bool {
	for _, m := range []string{http.MethodGet, http.MethodPost} {
		if m == r.Method {
			continue
		}
		clone := r.Clone(r.Context())
		clone.Method = m
		if _, p := mux.Handler(clone); p != "" {
			return true
		}
	}
	return false
}

func writeResponse(w http.ResponseWriter, resp Response) { writeJSON(w, resp.Status, resp.Body) }

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Printf("write response: %v", err)
	}
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "9004"
	}
	addr := ":" + port
	log.Printf("FinSim Go sample bank listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, NewHandler(NewBank())))
}
