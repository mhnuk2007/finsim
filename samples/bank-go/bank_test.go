package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

const cent = unitsPerWhole / 100

func legBody(tx, dir, acct, amount string) string {
	return fmt.Sprintf(`{"transactionId":%q,"direction":%q,"accountReference":%q,`+
		`"money":{"amount":%q,"currency":"USD"},"reference":"TEST","provenance":"SYNTHETIC"}`,
		tx, dir, acct, amount)
}

func do(t *testing.T, h http.Handler, method, path, key, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("%s %s: response is not JSON: %q", method, path, rec.Body.String())
	}
	return rec.Code, out
}

func balance(t *testing.T, b *Bank, ref string) int64 {
	t.Helper()
	v, ok := b.Balance(ref)
	if !ok {
		t.Fatalf("no account %s", ref)
	}
	return v
}

func TestHealthAndCapabilities(t *testing.T) {
	h := NewHandler(NewBank())
	code, body := do(t, h, "GET", "/finsim/v1/institution/health", "", "")
	if code != 200 || body["status"] != "UP" {
		t.Fatalf("health = %d %v", code, body)
	}
	code, body = do(t, h, "GET", "/finsim/v1/institution/capabilities", "", "")
	if code != 200 || body["institutionType"] != "BANK" {
		t.Fatalf("capabilities = %d %v", code, body)
	}
	caps := fmt.Sprint(body["capabilities"])
	for _, c := range []string{"ACCOUNT_DEBIT", "ACCOUNT_CREDIT", "STATUS_QUERY"} {
		if !strings.Contains(caps, c) {
			t.Errorf("capabilities %s missing %s", caps, c)
		}
	}
}

func TestPaymentOutcomes(t *testing.T) {
	tests := []struct {
		name     string
		dir      string
		acct     string
		amount   string
		wantCode int
		wantBody string // status for 201, error code otherwise
		wantAcc1 int64
		wantAcc2 int64
	}{
		{"debit succeeds", "DEBIT", "ACC-1", "100.25", 201, "COMPLETED", 39975 * cent / 1, 100 * unitsPerWhole},
		{"credit succeeds", "CREDIT", "ACC-2", "0.01", 201, "COMPLETED", 500 * unitsPerWhole, 100*unitsPerWhole + cent},
		{"insufficient funds", "DEBIT", "ACC-2", "100.01", 422, "AM04", 500 * unitsPerWhole, 100 * unitsPerWhole},
		{"unknown account", "CREDIT", "ACC-NOPE", "1.00", 422, "AC01", 500 * unitsPerWhole, 100 * unitsPerWhole},
		{"closed account", "CREDIT", "ACC-CLOSED", "1.00", 422, "AC04", 500 * unitsPerWhole, 100 * unitsPerWhole},
		{"zero amount", "CREDIT", "ACC-2", "0.00", 422, "AM02", 500 * unitsPerWhole, 100 * unitsPerWhole},
		{"exact balance debit", "DEBIT", "ACC-2", "100.00", 201, "COMPLETED", 500 * unitsPerWhole, 0},
		{"huge amount", "DEBIT", "ACC-1", "999999999.00", 422, "AM04", 500 * unitsPerWhole, 100 * unitsPerWhole},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			b := NewBank()
			h := NewHandler(b)
			code, body := do(t, h, "POST", "/finsim/v1/payments", "key-12345678", legBody("tx-1", tc.dir, tc.acct, tc.amount))
			if code != tc.wantCode {
				t.Fatalf("status = %d, want %d (%v)", code, tc.wantCode, body)
			}
			got := body["code"]
			if code == 201 {
				got = body["status"]
				if body["provenance"] != "SYNTHETIC" || body["participantReference"] == "" {
					t.Errorf("bad result body %v", body)
				}
			}
			if got != tc.wantBody {
				t.Errorf("body = %v, want %s", got, tc.wantBody)
			}
			if a := balance(t, b, "ACC-1"); a != tc.wantAcc1 {
				t.Errorf("ACC-1 = %d, want %d", a, tc.wantAcc1)
			}
			if a := balance(t, b, "ACC-2"); a != tc.wantAcc2 {
				t.Errorf("ACC-2 = %d, want %d", a, tc.wantAcc2)
			}
		})
	}
}

func TestValidation(t *testing.T) {
	good := legBody("tx-v", "DEBIT", "ACC-1", "1.00")
	tests := []struct {
		name string
		key  string
		body string
		code string
	}{
		{"missing key", "", good, "MISSING_IDEMPOTENCY_KEY"},
		{"short key", "short", good, "MISSING_IDEMPOTENCY_KEY"},
		{"not json", "key-12345678", "{ nope", "INVALID_REQUEST"},
		{"empty body", "key-12345678", "", "INVALID_REQUEST"},
		{"trailing data", "key-12345678", good + good, "INVALID_REQUEST"},
		{"unsupported field", "key-12345678", strings.Replace(good, `"reference"`, `"surprise":1,"reference"`, 1), "INVALID_REQUEST"},
		{"missing field", "key-12345678", strings.Replace(good, `"accountReference":"ACC-1",`, "", 1), "INVALID_REQUEST"},
		{"bad provenance", "key-12345678", strings.Replace(good, "SYNTHETIC", "REAL", 1), "INVALID_REQUEST"},
		{"bad amount", "key-12345678", legBody("tx-v", "DEBIT", "ACC-1", "ten dollars"), "INVALID_REQUEST"},
		{"negative amount", "key-12345678", legBody("tx-v", "DEBIT", "ACC-1", "-1.00"), "INVALID_REQUEST"},
		{"too many decimals", "key-12345678", legBody("tx-v", "DEBIT", "ACC-1", "1.123456789"), "INVALID_REQUEST"},
		{"numeric amount", "key-12345678", strings.Replace(good, `"1.00"`, `1.00`, 1), "INVALID_REQUEST"},
		{"amount overflow", "key-12345678", legBody("tx-v", "DEBIT", "ACC-1", "99999999999999999999"), "INVALID_REQUEST"},
		{"bad direction", "key-12345678", legBody("tx-v", "SIDEWAYS", "ACC-1", "1.00"), "INVALID_REQUEST"},
		{"bad currency", "key-12345678", strings.Replace(good, `"USD"`, `"usd"`, 1), "INVALID_REQUEST"},
		{"reversalOf on debit", "key-12345678", strings.Replace(good, `"reference"`, `"reversalOf":"x","reference"`, 1), "INVALID_REQUEST"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			b := NewBank()
			code, body := do(t, NewHandler(b), "POST", "/finsim/v1/payments", tc.key, tc.body)
			if code != 400 || body["code"] != tc.code {
				t.Errorf("got %d %v, want 400 %s", code, body, tc.code)
			}
			if balance(t, b, "ACC-1") != 500*unitsPerWhole {
				t.Error("balance changed on rejected request")
			}
		})
	}
}

func TestUnsupportedCurrency(t *testing.T) {
	h := NewHandler(NewBank())
	body := strings.Replace(legBody("tx-c", "CREDIT", "ACC-2", "1.00"), `"USD"`, `"XXX"`, 1)
	code, out := do(t, h, "POST", "/finsim/v1/payments", "key-12345678", body)
	if code != 422 || out["code"] != "AM03" {
		t.Errorf("got %d %v", code, out)
	}
}

func TestIdempotentReplayDoesNotDuplicate(t *testing.T) {
	b := NewBank()
	h := NewHandler(b)
	body := legBody("tx-r", "DEBIT", "ACC-1", "10.00")
	code1, first := do(t, h, "POST", "/finsim/v1/payments", "key-replay-1", body)
	code2, second := do(t, h, "POST", "/finsim/v1/payments", "key-replay-1", body)
	if code1 != 201 || code2 != 200 {
		t.Fatalf("codes = %d, %d; want 201, 200", code1, code2)
	}
	if first["participantReference"] != second["participantReference"] {
		t.Errorf("replay returned a different result: %v vs %v", first, second)
	}
	if got := balance(t, b, "ACC-1"); got != 490*unitsPerWhole {
		t.Errorf("balance = %d, want one debit only", got)
	}
}

func TestIdempotentReplayOfRejection(t *testing.T) {
	h := NewHandler(NewBank())
	body := legBody("tx-rej", "CREDIT", "ACC-CLOSED", "1.00")
	for i := 0; i < 2; i++ {
		code, out := do(t, h, "POST", "/finsim/v1/payments", "key-reject-1", body)
		if code != 422 || out["code"] != "AC04" {
			t.Fatalf("attempt %d: %d %v", i, code, out)
		}
	}
}

func TestIdempotencyConflict(t *testing.T) {
	b := NewBank()
	h := NewHandler(b)
	do(t, h, "POST", "/finsim/v1/payments", "key-conflict", legBody("tx-k", "DEBIT", "ACC-1", "10.00"))
	code, out := do(t, h, "POST", "/finsim/v1/payments", "key-conflict", legBody("tx-k", "DEBIT", "ACC-1", "20.00"))
	if code != 409 || out["code"] != "IDEMPOTENCY_CONFLICT" {
		t.Fatalf("got %d %v", code, out)
	}
	if got := balance(t, b, "ACC-1"); got != 490*unitsPerWhole {
		t.Errorf("balance = %d, conflict must not change it", got)
	}
}

func TestDuplicateLegWithNewKeyIsRejected(t *testing.T) {
	b := NewBank()
	h := NewHandler(b)
	body := legBody("tx-d", "DEBIT", "ACC-1", "10.00")
	do(t, h, "POST", "/finsim/v1/payments", "key-dupe-001", body)
	code, out := do(t, h, "POST", "/finsim/v1/payments", "key-dupe-002", body)
	if code != 422 || out["code"] != "DUPL" {
		t.Fatalf("got %d %v", code, out)
	}
	if got := balance(t, b, "ACC-1"); got != 490*unitsPerWhole {
		t.Errorf("balance = %d", got)
	}
}

func TestReversal(t *testing.T) {
	b := NewBank()
	h := NewHandler(b)
	do(t, h, "POST", "/finsim/v1/payments", "key-rev-0001", legBody("tx-a", "DEBIT", "ACC-1", "10.00"))
	rev := func(tx, of, amount string) string {
		return strings.Replace(legBody(tx, "CREDIT", "ACC-1", amount), `"reference"`, fmt.Sprintf(`"reversalOf":%q,"reference"`, of), 1)
	}
	if code, out := do(t, h, "POST", "/finsim/v1/payments", "key-rev-0002", rev("tx-a-rev-bad", "tx-a", "5.00")); code != 422 || out["code"] != "MS03" {
		t.Errorf("mismatched amount: %d %v", code, out)
	}
	if code, out := do(t, h, "POST", "/finsim/v1/payments", "key-rev-0003", rev("tx-a-rev-ok", "tx-a", "10.00")); code != 201 {
		t.Errorf("reversal: %d %v", code, out)
	}
	if code, out := do(t, h, "POST", "/finsim/v1/payments", "key-rev-0004", rev("tx-a-rev2", "tx-a", "10.00")); code != 422 || out["code"] != "DUPL" {
		t.Errorf("double reversal: %d %v", code, out)
	}
	if got := balance(t, b, "ACC-1"); got != 500*unitsPerWhole {
		t.Errorf("balance = %d, want original", got)
	}
}

func TestPaymentStatusLookup(t *testing.T) {
	h := NewHandler(NewBank())
	if code, out := do(t, h, "POST", "/finsim/v1/payments", "key-status-1", legBody("tx-s", "DEBIT", "ACC-1", "1.00")); code != 201 {
		t.Fatalf("setup debit: %d %v", code, out)
	}
	if code, out := do(t, h, "POST", "/finsim/v1/payments", "key-status-2", legBody("tx-s-rej", "CREDIT", "ACC-CLOSED", "1.00")); code != 422 {
		t.Fatalf("setup rejection: %d %v", code, out)
	}

	tests := []struct {
		name       string
		path       string
		wantCode   int
		wantStatus string
		wantReason string
		wantErr    string
	}{
		{"completed", "/finsim/v1/payments/tx-s?leg=DEBIT", 200, "COMPLETED", "", ""},
		{"rejected is remembered", "/finsim/v1/payments/tx-s-rej?leg=CREDIT", 200, "REJECTED", "AC04", ""},
		{"unknown transaction", "/finsim/v1/payments/tx-nope?leg=DEBIT", 404, "", "", "LEG_NOT_FOUND"},
		{"other leg never arrived", "/finsim/v1/payments/tx-s?leg=CREDIT", 404, "", "", "LEG_NOT_FOUND"},
		{"missing leg", "/finsim/v1/payments/tx-s", 400, "", "", "INVALID_REQUEST"},
		{"bad leg", "/finsim/v1/payments/tx-s?leg=SIDEWAYS", 400, "", "", "INVALID_REQUEST"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			code, body := do(t, h, "GET", tc.path, "", "")
			if code != tc.wantCode {
				t.Fatalf("status = %d, want %d (%v)", code, tc.wantCode, body)
			}
			if tc.wantErr != "" && body["code"] != tc.wantErr {
				t.Errorf("code = %v, want %s", body["code"], tc.wantErr)
			}
			if tc.wantStatus != "" && body["status"] != tc.wantStatus {
				t.Errorf("status = %v, want %s", body["status"], tc.wantStatus)
			}
			if tc.wantReason != "" && body["reasonCode"] != tc.wantReason {
				t.Errorf("reasonCode = %v, want %s", body["reasonCode"], tc.wantReason)
			}
		})
	}
}

func TestUnknownRoute(t *testing.T) {
	h := NewHandler(NewBank())
	if code, body := do(t, h, "GET", "/nope", "", ""); code != 404 || body["code"] != "NOT_FOUND" {
		t.Errorf("got %d %v", code, body)
	}
	if code, body := do(t, h, "DELETE", "/finsim/v1/payments", "", ""); code != 405 || body["code"] == nil {
		t.Errorf("got %d %v", code, body)
	}
}

func TestParseAmount(t *testing.T) {
	tests := []struct {
		in   string
		want int64
		ok   bool
	}{
		{"0", 0, true},
		{"100.00", 100 * unitsPerWhole, true},
		{"0.10", unitsPerWhole / 10, true},
		{"0.00000001", 1, true},
		{"1.", 0, false},
		{".5", 0, false},
		{"1e3", 0, false},
		{"1.123456789", 0, false},
	}
	for _, tc := range tests {
		got, err := parseAmount(tc.in)
		if (err == nil) != tc.ok || (tc.ok && got != tc.want) {
			t.Errorf("parseAmount(%q) = %d, %v", tc.in, got, err)
		}
	}
}

func TestConcurrentPaymentsKeepBalancesConsistent(t *testing.T) {
	b := NewBank()
	h := NewHandler(b)
	const workers = 100 // 50 debits of 5.00 against 500.00, plus replays

	var wg sync.WaitGroup
	var mu sync.Mutex
	counts := map[int]int{}
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			n := i % 50 // each payment is sent twice with the same key
			code, _ := do(t, h, "POST", "/finsim/v1/payments", fmt.Sprintf("key-conc-%04d", n),
				legBody(fmt.Sprintf("tx-conc-%d", n), "DEBIT", "ACC-1", "5.00"))
			mu.Lock()
			counts[code]++
			mu.Unlock()
		}(i)
	}
	wg.Wait()

	if counts[201] != 50 || counts[200] != 50 {
		t.Errorf("status counts = %v, want 50x201 and 50x200", counts)
	}
	if got := balance(t, b, "ACC-1"); got != 250*unitsPerWhole {
		t.Errorf("ACC-1 = %d, want 250.00", got)
	}
}

func TestConcurrentDebitsCannotOverdraw(t *testing.T) {
	b := NewBank()
	h := NewHandler(b)
	var wg sync.WaitGroup
	var mu sync.Mutex
	ok := 0
	for i := 0; i < 20; i++ { // 20 x 10.00 against 100.00
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			code, _ := do(t, h, "POST", "/finsim/v1/payments", fmt.Sprintf("key-over-%04d", i),
				legBody(fmt.Sprintf("tx-over-%d", i), "DEBIT", "ACC-2", "10.00"))
			if code == 201 {
				mu.Lock()
				ok++
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	if ok != 10 || balance(t, b, "ACC-2") != 0 {
		t.Errorf("succeeded = %d, balance = %d; want 10 and 0", ok, balance(t, b, "ACC-2"))
	}
}
