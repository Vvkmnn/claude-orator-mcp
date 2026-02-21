#!/usr/bin/env bash
#
# MCP-level self-test: calls orator_optimize via JSONRPC stdio transport.
# Validates that the server responds correctly to real MCP protocol messages.
#
# Usage: bash test/mcp-test.sh
# Requires: jq, node, dist/index.js (run npm run build first)

set -uo pipefail

PASS=0
FAIL=0
TOTAL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() {
  ((PASS++)) || true
  ((TOTAL++)) || true
  printf "  ${GREEN}PASS${NC}  %s\n" "$1"
}

fail() {
  ((FAIL++)) || true
  ((TOTAL++)) || true
  printf "  ${RED}FAIL${NC}  %s\n" "$1"
  printf "        %s\n" "$2"
}

# Call orator_optimize via MCP JSONRPC and return the tools/call response line
call_orator() {
  local args="$1"
  printf '%s\n%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"orator_optimize\",\"arguments\":${args}}}" \
    | timeout 10s node dist/index.js 2>/dev/null | tail -1
}

# Extract the JSON payload from the MCP response text
# The text is: "notification\n\n{json}" — we need the json part
extract_json() {
  local mcp_response="$1"
  echo "$mcp_response" | jq -r '.result.content[0].text' | sed '1,/^$/d'
}

extract_field() {
  local mcp_response="$1"
  local field="$2"
  local json
  json=$(extract_json "$mcp_response")
  echo "$json" | jq -r ".$field"
}

echo "MCP-level self-test for claude-orator-mcp"
echo "=========================================="
echo ""

# --- Test 1: Basic MCP response structure ---
RESULT=$(call_orator '{"prompt":"write a sort function"}')
if echo "$RESULT" | jq -e '.result.content[0].text' > /dev/null 2>&1; then
  pass "MCP response has correct structure (.result.content[0].text)"
else
  fail "MCP response has correct structure" "Missing .result.content[0].text"
fi

# --- Test 2: Score fields present ---
SCORE_BEFORE=$(extract_field "$RESULT" "score_before")
SCORE_AFTER=$(extract_field "$RESULT" "score_after")
if [[ "$SCORE_BEFORE" != "null" && "$SCORE_AFTER" != "null" ]]; then
  pass "score_before ($SCORE_BEFORE) and score_after ($SCORE_AFTER) present"
else
  fail "Score fields present" "score_before=$SCORE_BEFORE score_after=$SCORE_AFTER"
fi

# --- Test 3: Intent detection ---
INTENT=$(extract_field "$RESULT" "detected_intent")
if [[ "$INTENT" == "code" ]]; then
  pass "Intent: 'write a sort function' → code"
else
  fail "Intent detection" "Expected 'code', got '$INTENT'"
fi

# --- Test 4: Score honesty ---
RESULT2=$(call_orator '{"prompt":"do stuff with things"}')
SB=$(extract_field "$RESULT2" "score_before")
SA=$(extract_field "$RESULT2" "score_after")
INFLATED=$(awk "BEGIN {print ($SA == $SB + 0.5) ? \"yes\" : \"no\"}")
if [[ "$INFLATED" == "no" ]]; then
  pass "Score honesty: no artificial +0.5 inflation ($SB → $SA)"
else
  fail "Score honesty" "score_after ($SA) = score_before ($SB) + 0.5"
fi

# --- Test 5: Anti-pattern detection ---
RESULT3=$(call_orator '{"prompt":"Be creative and do your best"}')
ISSUES=$(extract_field "$RESULT3" "issues")
if echo "$ISSUES" | grep -qi "be creative"; then
  pass "Anti-pattern: 'Be creative' flagged"
else
  fail "Anti-pattern detection" "Expected 'be creative' in issues"
fi

# --- Test 6: XML example detection ---
RESULT4=$(call_orator '{"prompt":"<task>Extract emails</task><examples><example><input>hello foo@bar.com</input><output>foo@bar.com</output></example></examples>","target":"claude-api"}')
SA4=$(extract_field "$RESULT4" "score_after")
if awk "BEGIN {exit !($SA4 >= 3.5)}"; then
  pass "XML example detection: structured prompt scores $SA4"
else
  fail "XML example detection" "Expected score >= 3.5, got $SA4"
fi

# --- Test 7: Target filtering ---
RESULT5=$(call_orator '{"prompt":"Review this authentication code and fix the SQL injection vulnerability. Refactor the token validation logic.","target":"claude-code"}')
TECHS5=$(extract_field "$RESULT5" "applied_techniques")
if echo "$TECHS5" | grep -q "chain-of-thought"; then
  fail "Target filtering" "chain-of-thought should be skipped for claude-code"
else
  pass "Target filtering: claude-code skips chain-of-thought"
fi

# --- Test 8: Multi-step → prompt-chaining ---
RESULT6=$(call_orator '{"prompt":"First parse the CSV file, then validate each row against the schema, then transform valid rows to JSON, finally write to the database","target":"claude-api"}')
TECHS6=$(extract_field "$RESULT6" "applied_techniques")
if echo "$TECHS6" | grep -q "prompt-chaining"; then
  pass "Multi-step: prompt-chaining triggered"
else
  fail "Multi-step" "Expected prompt-chaining in: $TECHS6"
fi

# --- Test 9: Forced techniques ---
RESULT7=$(call_orator '{"prompt":"Write hello world","techniques":["xml-tags","few-shot"]}')
TECHS7=$(extract_field "$RESULT7" "applied_techniques")
if echo "$TECHS7" | grep -q "xml-tags" && echo "$TECHS7" | grep -q "few-shot"; then
  pass "Forced techniques: xml-tags + few-shot applied"
else
  fail "Forced techniques" "Expected xml-tags and few-shot in: $TECHS7"
fi

# --- Test 10: High-quality early return ---
HQ_PROMPT=$(cat <<'PROMPT'
<task>
Write a TypeScript function that validates emails using RFC 5322.
</task>

<requirements>
- Handle: empty string, null, Unicode domains
- Return { valid: boolean; reason?: string }
- Maximum 50ms per validation
</requirements>

<examples>
<example>
<input>user@example.com</input>
<output>{ "valid": true }</output>
</example>
</examples>

<output_format>
TypeScript code block with JSDoc.
</output_format>
PROMPT
)
# Escape the prompt for JSON (compact, single line)
HQ_JSON=$(echo "$HQ_PROMPT" | jq -Rsc '{prompt: .}')
RESULT8=$(call_orator "$HQ_JSON")
SA8=$(extract_field "$RESULT8" "score_after")
if awk "BEGIN {exit !($SA8 >= 7.0)}"; then
  pass "High-quality prompt: score $SA8"
else
  fail "High-quality prompt" "Expected >= 7.0, got $SA8"
fi

# --- Test 11: Tool-use detection ---
RESULT9=$(call_orator '{"prompt":"Use the MCP tools to call the GitHub API and create an issue. Invoke the search tool first.","target":"claude-api"}')
TECHS9=$(extract_field "$RESULT9" "applied_techniques")
if echo "$TECHS9" | grep -q "tool-use"; then
  pass "Tool-use: detected and applied"
else
  fail "Tool-use detection" "Expected tool-use in: $TECHS9"
fi

# --- Test 12: Error handling — unknown tool ---
RESULT10=$(printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"nonexistent_tool","arguments":{}}}' \
  | timeout 10s node dist/index.js 2>/dev/null | tail -1)
IS_ERROR=$(echo "$RESULT10" | jq -r '.result.isError // false')
if [[ "$IS_ERROR" == "true" ]]; then
  pass "Error handling: unknown tool → isError=true"
else
  fail "Error handling" "Expected isError=true, got: $IS_ERROR"
fi

# --- Test 13: Hybrid intent — "review this PR" → code ---
RESULT11=$(call_orator '{"prompt":"Review this pull request for potential bugs and security issues"}')
INTENT11=$(extract_field "$RESULT11" "detected_intent")
if [[ "$INTENT11" == "code" ]]; then
  pass "Hybrid intent: 'review this PR' → code"
else
  fail "Hybrid intent" "Expected 'code', got '$INTENT11'"
fi

# --- Test 14: Regression guard ---
RESULT12=$(call_orator '{"prompt":"You are a TypeScript expert. Write clean, well-tested code. Always use strict mode.","intent":"system"}')
SB12=$(extract_field "$RESULT12" "score_before")
SA12=$(extract_field "$RESULT12" "score_after")
if awk "BEGIN {exit !($SA12 >= $SB12)}"; then
  pass "Regression guard: $SB12 → $SA12 (no regression)"
else
  fail "Regression guard" "score_after ($SA12) < score_before ($SB12)"
fi

# --- Test 15: Generic assistant anti-pattern ---
RESULT13=$(call_orator '{"prompt":"You are a helpful AI assistant that helps users with code"}')
ISSUES13=$(extract_field "$RESULT13" "issues")
if echo "$ISSUES13" | grep -qi "assistant\|generic"; then
  pass "Anti-pattern: 'helpful AI assistant' flagged"
else
  fail "Anti-pattern: helpful assistant" "Expected generic/assistant issue in: $ISSUES13"
fi

echo ""
echo "$PASS passed, $FAIL failed, $TOTAL total"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
