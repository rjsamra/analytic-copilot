# Manual test scenarios — User Semantic Layer MVP

Run backend (`./start-api.sh`) and frontend (`./start-ui.sh`).

## Persona differences

1. Select **Regional Manager — Western Europe**
2. Ask: `Give me revenue of last month`
3. Pick **Recognized Revenue** when prompted
4. Verify pipeline Resolve step shows Western Europe scope
5. Verify SQL uses `ShippedDate` and `ShipCountry` for EU countries (Germany, France, UK, …)
6. Verify result is non-zero (~2.1M for Oct 2023 WE shipped revenue)

7. Switch to **Finance Analyst — Global**
8. Ask same question, pick **Booked Revenue**
9. Verify SQL uses `OrderDate` with no country filter

## Clarification flow

1. Ask `Give me revenue of last month` without pre-selecting
2. Verify clarification chips appear in chat before results
3. Pipeline Resolve step stays active until selection

## Validation visibility

1. Complete any revenue question
2. Check Pipeline: Validate, Sanity, Confirm steps all show status
3. Check chat: Assumptions card below result
4. Check Semantic tab: persona, metric, filters, cache status

## Feedback cache

1. Ask `Give me revenue of last month` (after clarification if needed)
2. Click **Looks correct**
3. Ask the same question again
4. Verify Resolve step shows **CACHE HIT**
5. Click **Wrong metric** on a subsequent answer — cache should invalidate

## Guardrails + semantic layer

1. Attach **Revenue on ShippedDate** guardrail
2. Ask revenue question with Finance persona using Booked Revenue
3. Both guardrail and semantic assumptions should appear in pipeline
