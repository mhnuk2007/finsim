package main

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
)

// Amounts are held as int64 counts of 1e-8 currency units, which is the most
// precision the contract allows (up to 8 decimal places). No floats are used.
const (
	amountScale    = 8
	unitsPerWhole  = int64(100_000_000)
	maxWholeAmount = int64(90_000_000_000) // keeps whole*unitsPerWhole inside int64
)

var (
	amountPattern   = regexp.MustCompile(`^\d+(\.\d{1,8})?$`)
	currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)
)

// Money is the contract's Money schema (decimal string amount plus currency).
type Money struct {
	Amount   string `json:"amount"`
	Currency string `json:"currency"`
}

// PaymentLegRequest is the contract's PaymentLegRequest schema.
type PaymentLegRequest struct {
	TransactionID    string `json:"transactionId"`
	Direction        string `json:"direction"`
	AccountReference string `json:"accountReference"`
	Money            Money  `json:"money"`
	Reference        string `json:"reference"`
	ReversalOf       string `json:"reversalOf,omitempty"`
	Provenance       string `json:"provenance"`
}

// PaymentLegResult is the contract's PaymentLegResult schema.
type PaymentLegResult struct {
	TransactionID        string `json:"transactionId"`
	Direction            string `json:"direction"`
	Status               string `json:"status"`
	ReasonCode           string `json:"reasonCode,omitempty"`
	ParticipantReference string `json:"participantReference,omitempty"`
	Provenance           string `json:"provenance"`
}

// ErrorBody is the contract's Error schema.
type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Response is an HTTP status plus the JSON body to send.
type Response struct {
	Status int
	Body   any
}

type account struct {
	balance int64
	closed  bool
}

type legKey struct {
	transactionID string
	direction     string
}

type legRecord struct {
	request PaymentLegRequest
	units   int64
	result  PaymentLegResult
}

type idempotencyEntry struct {
	fingerprint PaymentLegRequest
	response    Response
}

// Bank is a synthetic in-memory institution. All state is guarded by mu.
type Bank struct {
	mu          sync.RWMutex
	accounts    map[string]*account
	idempotency map[string]idempotencyEntry
	legs        map[legKey]*legRecord
	reversed    map[string]bool
	sequence    int
}

// NewBank returns a bank seeded with the synthetic sample accounts.
func NewBank() *Bank {
	return &Bank{
		accounts: map[string]*account{
			"ACC-1":      {balance: 500 * unitsPerWhole},
			"ACC-2":      {balance: 100 * unitsPerWhole},
			"ACC-CLOSED": {balance: 0, closed: true},
		},
		idempotency: map[string]idempotencyEntry{},
		legs:        map[legKey]*legRecord{},
		reversed:    map[string]bool{},
	}
}

// Balance returns an account balance in 1e-8 units (for tests).
func (b *Bank) Balance(ref string) (int64, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	acc, ok := b.accounts[ref]
	if !ok {
		return 0, false
	}
	return acc.balance, true
}

// Apply processes one payment leg under an idempotency key.
func (b *Bank) Apply(key string, req PaymentLegRequest) Response {
	if len(key) < 8 || len(key) > 128 {
		return errorResponse(400, "MISSING_IDEMPOTENCY_KEY",
			"The Idempotency-Key header is required (8 to 128 characters).")
	}
	units, err := validate(req)
	if err != nil {
		return errorResponse(400, "INVALID_REQUEST", err.Error())
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	if prev, ok := b.idempotency[key]; ok {
		if prev.fingerprint != req {
			return errorResponse(409, "IDEMPOTENCY_CONFLICT",
				"This Idempotency-Key was used with a different request.")
		}
		resp := prev.response
		if resp.Status == 201 {
			resp.Status = 200
		}
		return resp
	}

	resp := b.process(req, units)
	b.idempotency[key] = idempotencyEntry{fingerprint: req, response: resp}
	return resp
}

// Status returns the recorded leg, if any.
func (b *Bank) Status(transactionID, direction string) (PaymentLegResult, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	rec, ok := b.legs[legKey{transactionID, direction}]
	if !ok {
		return PaymentLegResult{}, false
	}
	return rec.result, true
}

// process must be called with b.mu held for writing.
func (b *Bank) process(req PaymentLegRequest, units int64) Response {
	key := legKey{req.TransactionID, req.Direction}
	if _, exists := b.legs[key]; exists {
		return b.reject(req, "DUPL", "A leg with this transactionId and direction already exists.", false)
	}
	if req.Money.Currency != "USD" {
		return b.reject(req, "AM03", "Currency not supported by this institution.", true)
	}
	if units <= 0 {
		return b.reject(req, "AM02", "Amount must be greater than zero.", true)
	}
	acc, ok := b.accounts[req.AccountReference]
	if !ok {
		return b.reject(req, "AC01", "Account does not exist.", true)
	}
	if acc.closed {
		return b.reject(req, "AC04", "Account is closed.", true)
	}
	if req.ReversalOf != "" {
		orig := b.legs[legKey{req.ReversalOf, "DEBIT"}]
		if orig == nil || orig.result.Status != "COMPLETED" ||
			orig.request.AccountReference != req.AccountReference || orig.units != units {
			return b.reject(req, "MS03", "reversalOf does not match a completed debit.", true)
		}
		if b.reversed[req.ReversalOf] {
			return b.reject(req, "DUPL", "That debit has already been reversed.", true)
		}
	}
	if req.Direction == "DEBIT" {
		if acc.balance < units {
			return b.reject(req, "AM04", "Insufficient funds.", true)
		}
		acc.balance -= units
	} else {
		if acc.balance > int64(^uint64(0)>>1)-units {
			return b.reject(req, "AM02", "Credit would overflow the balance.", true)
		}
		acc.balance += units
	}
	if req.ReversalOf != "" {
		b.reversed[req.ReversalOf] = true
	}
	b.sequence++
	result := PaymentLegResult{
		TransactionID:        req.TransactionID,
		Direction:            req.Direction,
		Status:               "COMPLETED",
		ParticipantReference: fmt.Sprintf("bank-go-%d", b.sequence),
		Provenance:           "SYNTHETIC",
	}
	b.legs[key] = &legRecord{request: req, units: units, result: result}
	return Response{Status: 201, Body: result}
}

func (b *Bank) reject(req PaymentLegRequest, code, message string, remember bool) Response {
	b.sequence++
	if remember {
		units, _ := parseAmount(req.Money.Amount)
		b.legs[legKey{req.TransactionID, req.Direction}] = &legRecord{
			request: req,
			units:   units,
			result: PaymentLegResult{
				TransactionID:        req.TransactionID,
				Direction:            req.Direction,
				Status:               "REJECTED",
				ReasonCode:           code,
				ParticipantReference: fmt.Sprintf("bank-go-%d", b.sequence),
				Provenance:           "SYNTHETIC",
			},
		}
	}
	return errorResponse(422, code, message)
}

func errorResponse(status int, code, message string) Response {
	return Response{Status: status, Body: ErrorBody{Code: code, Message: message}}
}

func validate(req PaymentLegRequest) (int64, error) {
	if req.TransactionID == "" || len(req.TransactionID) > 128 {
		return 0, errors.New("transactionId is required (up to 128 characters).")
	}
	if req.Direction != "DEBIT" && req.Direction != "CREDIT" {
		return 0, errors.New("direction must be DEBIT or CREDIT.")
	}
	if req.AccountReference == "" {
		return 0, errors.New("accountReference is required.")
	}
	units, err := parseAmount(req.Money.Amount)
	if err != nil {
		return 0, err
	}
	if !currencyPattern.MatchString(req.Money.Currency) {
		return 0, errors.New("money.currency must be three uppercase letters.")
	}
	if req.Reference == "" || len(req.Reference) > 140 {
		return 0, errors.New("reference is required (up to 140 characters).")
	}
	if req.Provenance != "SYNTHETIC" {
		return 0, errors.New("provenance must be SYNTHETIC.")
	}
	if req.ReversalOf != "" && req.Direction != "CREDIT" {
		return 0, errors.New("reversalOf is only valid on a CREDIT leg.")
	}
	return units, nil
}

// parseAmount converts a decimal string such as "100.25" to 1e-8 units exactly.
func parseAmount(s string) (int64, error) {
	bad := errors.New("money.amount must be a decimal string with at most 8 decimal places.")
	if !amountPattern.MatchString(s) {
		return 0, bad
	}
	whole, frac, _ := strings.Cut(s, ".")
	frac += strings.Repeat("0", amountScale-len(frac))
	var w, f int64
	for _, c := range whole {
		w = w*10 + int64(c-'0')
		if w > maxWholeAmount {
			return 0, errors.New("money.amount is too large.")
		}
	}
	for _, c := range frac {
		f = f*10 + int64(c-'0')
	}
	return w*unitsPerWhole + f, nil
}
