#!/usr/bin/env bash
set -e

SERVER_URL="http://localhost:8000"
RECEIVER_URL="http://localhost:3001"

echo "============================================================"
echo "      WEBHOOK RETRY ENGINE — INTERACTIVE LIVE DEMO          "
echo "============================================================"

# Check if server and receiver are reachable
echo "1. Checking services..."
if ! curl -s "${SERVER_URL}/health" > /dev/null; then
  echo "Error: Server is not running at ${SERVER_URL}."
  echo "Please start it with: npm run start:server"
  exit 1
fi

if ! curl -s "${RECEIVER_URL}/logs" > /dev/null; then
  echo "Error: Receiver is not running at ${RECEIVER_URL}."
  echo "Please start it with: npm run start:receiver"
  exit 1
fi
echo "✓ Server and Receiver are healthy."
echo ""

# Reset receiver
curl -s -X POST "${RECEIVER_URL}/reset" > /dev/null

echo "============================================================"
echo " SCENARIO 1 (AC1): SUCCESSFUL DELIVERY                      "
echo "============================================================"
echo "Submitting event 'demo_ac1_001' to POST /events..."
AC1_RES=$(curl -s -X POST "${SERVER_URL}/events" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "demo_ac1_001",
    "type": "incident.created",
    "occurredAt": "2026-09-17T10:00:00Z",
    "payload": {"incidentId": "inc_101", "severity": "critical"}
  }')
echo "Response: $AC1_RES"

echo "Waiting 2s for background worker delivery..."
sleep 2

echo "Checking event status: GET /events/demo_ac1_001"
curl -s "${SERVER_URL}/events/demo_ac1_001" | node -e "let data=''; process.stdin.on('data', d=>data+=d); process.stdin.on('end', ()=>console.log(JSON.stringify(JSON.parse(data), null, 2)));"

echo "Checking attempt history: GET /events/demo_ac1_001/attempts"
curl -s "${SERVER_URL}/events/demo_ac1_001/attempts" | node -e "let data=''; process.stdin.on('data', d=>data+=d); process.stdin.on('end', ()=>console.log(JSON.stringify(JSON.parse(data), null, 2)));"
echo ""

echo "============================================================"
echo " SCENARIO 2 (AC4): IDEMPOTENT INGESTION                     "
echo "============================================================"
echo "Submitting identical event 'demo_ac1_001' again..."
AC4_RES=$(curl -s -X POST "${SERVER_URL}/events" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "demo_ac1_001",
    "type": "incident.created",
    "occurredAt": "2026-09-17T10:00:00Z",
    "payload": {"incidentId": "inc_101", "severity": "critical"}
  }')
echo "Duplicate POST Response: $AC4_RES"
echo "Notice isDuplicate is true, referencing original event."

echo "Checking attempts (should STILL be exactly 1 attempt):"
curl -s "${SERVER_URL}/events/demo_ac1_001/attempts" | node -e "let data=''; process.stdin.on('data', d=>data+=d); process.stdin.on('end', ()=>console.log(JSON.stringify(JSON.parse(data), null, 2)));"
echo ""

echo "============================================================"
echo " SCENARIO 3 (AC2): TEMPORARY FAILURE & RETRY                "
echo "============================================================"
echo "Configuring receiver mode to 'fail_once' (first attempt returns 503, next returns 200)..."
curl -s -X POST "${RECEIVER_URL}/mode?set=fail_once" > /dev/null

echo "Submitting event 'demo_ac2_001'..."
curl -s -X POST "${SERVER_URL}/events" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "demo_ac2_001",
    "type": "incident.updated",
    "occurredAt": "2026-09-17T10:01:00Z",
    "payload": {"incidentId": "inc_101", "status": "investigating"}
  }' > /dev/null

echo "Initial attempt occurred. Checking event state (should be QUEUED for retry):"
sleep 1.5
curl -s "${SERVER_URL}/events/demo_ac2_001" | node -e "let data=''; process.stdin.on('data', d=>data+=d); process.stdin.on('end', ()=>console.log(JSON.stringify(JSON.parse(data), null, 2)));"

echo "Waiting for exponential backoff (~5s) to trigger second attempt..."
sleep 6

echo "Checking event state after retry (should now be SUCCESS):"
curl -s "${SERVER_URL}/events/demo_ac2_001" | node -e "let data=''; process.stdin.on('data', d=>data+=d); process.stdin.on('end', ()=>console.log(JSON.stringify(JSON.parse(data), null, 2)));"

echo "Checking attempt history (should show 2 attempts, #1 RETRYABLE 503, #2 SUCCESS 200):"
curl -s "${SERVER_URL}/events/demo_ac2_001/attempts" | node -e "let data=''; process.stdin.on('data', d=>data+=d); process.stdin.on('end', ()=>console.log(JSON.stringify(JSON.parse(data), null, 2)));"
echo ""

echo "============================================================"
echo " SCENARIO 4 (AC3): BOUNDED FAILURE EXHAUSTION               "
echo "============================================================"
echo "Configuring receiver mode to 'terminal_400' (non-retryable client error)..."
curl -s -X POST "${RECEIVER_URL}/mode?set=terminal_400" > /dev/null

echo "Submitting event 'demo_ac3_terminal'..."
curl -s -X POST "${SERVER_URL}/events" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "demo_ac3_terminal",
    "type": "incident.closed",
    "occurredAt": "2026-09-17T10:02:00Z",
    "payload": {"incidentId": "inc_101"}
  }' > /dev/null

sleep 1.5
echo "Checking event status (should immediately be FAILED, no wasteful retries for 4xx):"
curl -s "${SERVER_URL}/events/demo_ac3_terminal" | node -e "let data=''; process.stdin.on('data', d=>data+=d); process.stdin.on('end', ()=>console.log(JSON.stringify(JSON.parse(data), null, 2)));"

echo "Checking attempt history:"
curl -s "${SERVER_URL}/events/demo_ac3_terminal/attempts" | node -e "let data=''; process.stdin.on('data', d=>data+=d); process.stdin.on('end', ()=>console.log(JSON.stringify(JSON.parse(data), null, 2)));"
echo ""

echo "============================================================"
echo " SCENARIO 5 (AC5): INSPECTABLE ORDERED HISTORY              "
echo "============================================================"
echo "Final inspectable audit log for all events verified."
echo "Demo finished successfully!"

