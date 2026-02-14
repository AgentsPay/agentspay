# AgentPay QA Test Suite - Round 2
# Fresh DB Test

$results = @()
$baseUrl = "http://localhost:3100"

function Test-Endpoint {
    param(
        [string]$TestNum,
        [string]$Description,
        [string]$Uri,
        [string]$Method = "GET",
        [hashtable]$Headers = @{},
        [string]$Body = $null,
        [string]$ExpectedStatus = "200",
        [scriptblock]$Validation = $null
    )
    
    Write-Host "`n[$TestNum] $Description" -ForegroundColor Cyan
    Write-Host "  URI: $Method $Uri"
    
    try {
        $params = @{
            Uri = $Uri
            Method = $Method
            Headers = $Headers
        }
        
        if ($Body) {
            $params.Body = $Body
            $params.ContentType = "application/json"
        }
        
        $response = Invoke-WebRequest @params -ErrorAction Stop
        $content = $response.Content
        
        if ($response.StatusCode -eq $ExpectedStatus) {
            if ($Validation) {
                $validationResult = & $Validation $content
                if ($validationResult) {
                    Write-Host "  PASS ✓" -ForegroundColor Green
                    return @{ Test=$TestNum; Status="PASS"; Details=$Description }
                } else {
                    Write-Host "  FAIL - Validation failed" -ForegroundColor Red
                    return @{ Test=$TestNum; Status="FAIL"; Details="$Description - Validation failed"; Response=$content }
                }
            } else {
                Write-Host "  PASS ✓" -ForegroundColor Green
                return @{ Test=$TestNum; Status="PASS"; Details=$Description; Response=$content }
            }
        } else {
            Write-Host "  FAIL - Expected $ExpectedStatus, got $($response.StatusCode)" -ForegroundColor Red
            return @{ Test=$TestNum; Status="FAIL"; Details="$Description - Wrong status code"; Response=$content }
        }
    }
    catch {
        $statusCode = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { "N/A" }
        $errorBody = if ($_.ErrorDetails) { $_.ErrorDetails.Message } else { $_.Exception.Message }
        
        if ($statusCode -eq $ExpectedStatus) {
            Write-Host "  PASS ✓ (Error with expected status)" -ForegroundColor Green
            return @{ Test=$TestNum; Status="PASS"; Details="$Description (expected error)"; Response=$errorBody }
        } else {
            Write-Host "  FAIL - Error: $errorBody" -ForegroundColor Red
            return @{ Test=$TestNum; Status="FAIL"; Details=$Description; Error=$errorBody; StatusCode=$statusCode }
        }
    }
}

Write-Host "=== AgentPay QA Test Suite - Round 2 ===" -ForegroundColor Yellow
Write-Host "Testing API at: $baseUrl`n"

# Phase 1: Wallet Creation
Write-Host "`n=== PHASE 1: WALLET CREATION ===" -ForegroundColor Yellow

$result = Test-Endpoint -TestNum "1" -Description "Create first wallet" `
    -Uri "$baseUrl/api/wallets/connect/internal" -Method POST `
    -Validation { param($c) $json = $c | ConvertFrom-Json; $json.ok -and $json.wallet -and $json.apiKey -and $json.privateKey }

$results += $result
if ($result.Status -eq "PASS") {
    $wallet1Data = $result.Response | ConvertFrom-Json
    $wallet1Id = $wallet1Data.wallet.id
    $apiKey1 = $wallet1Data.apiKey
    Write-Host "  Wallet1 ID: $wallet1Id" -ForegroundColor Gray
    Write-Host "  API Key1: $apiKey1" -ForegroundColor Gray
}

$result = Test-Endpoint -TestNum "2" -Description "Create second wallet" `
    -Uri "$baseUrl/api/wallets/connect/internal" -Method POST `
    -Validation { param($c) $json = $c | ConvertFrom-Json; $json.ok -and $json.wallet -and $json.apiKey }

$results += $result
if ($result.Status -eq "PASS") {
    $wallet2Data = $result.Response | ConvertFrom-Json
    $wallet2Id = $wallet2Data.wallet.id
    $apiKey2 = $wallet2Data.apiKey
    Write-Host "  Wallet2 ID: $wallet2Id" -ForegroundColor Gray
}

# Phase 2: Wallet Operations
Write-Host "`n=== PHASE 2: WALLET OPERATIONS ===" -ForegroundColor Yellow

if ($wallet1Id -and $apiKey1) {
    $result = Test-Endpoint -TestNum "4" -Description "GET wallet with correct API key" `
        -Uri "$baseUrl/api/wallets/$wallet1Id" -Method GET -Headers @{"X-API-Key"=$apiKey1} `
        -Validation { param($c) $json = $c | ConvertFrom-Json; $json.id -and !$json.privateKey }
    $results += $result
}

if ($wallet1Id) {
    $result = Test-Endpoint -TestNum "5" -Description "GET wallet WITHOUT API key (should 401)" `
        -Uri "$baseUrl/api/wallets/$wallet1Id" -Method GET -ExpectedStatus "401"
    $results += $result
}

if ($wallet1Id -and $apiKey2) {
    $result = Test-Endpoint -TestNum "6" -Description "GET wallet with WRONG API key (should 403)" `
        -Uri "$baseUrl/api/wallets/$wallet1Id" -Method GET -Headers @{"X-API-Key"=$apiKey2} -ExpectedStatus "403"
    $results += $result
}

if ($wallet1Id -and $apiKey1) {
    $result = Test-Endpoint -TestNum "7" -Description "Fund wallet with BSV" `
        -Uri "$baseUrl/api/wallets/$wallet1Id/fund" -Method POST `
        -Headers @{"X-API-Key"=$apiKey1} -Body '{"amount": 50000}' `
        -Validation { param($c) $json = $c | ConvertFrom-Json; $json.balance -ge 50000 }
    $results += $result
}

if ($wallet1Id -and $apiKey1) {
    $result = Test-Endpoint -TestNum "8" -Description "Fund wallet with MNEE" `
        -Uri "$baseUrl/api/wallets/$wallet1Id/fund-mnee" -Method POST `
        -Headers @{"X-API-Key"=$apiKey1} -Body '{"amount": 1000}'
    $results += $result
}

$result = Test-Endpoint -TestNum "9" -Description "GET BSV/USD rate" `
    -Uri "$baseUrl/api/rates" -Method GET `
    -Validation { param($c) $json = $c | ConvertFrom-Json; $json.rate -gt 0 }
$results += $result

# Phase 3: Service Registration
Write-Host "`n=== PHASE 3: SERVICE REGISTRATION ===" -ForegroundColor Yellow

if ($wallet1Id -and $apiKey1) {
    $serviceBody = @{
        name = "TestService"
        description = "A test service"
        price = 100
        currency = "BSV"
        endpoint = "https://example.com/api"
        category = "test"
        agentId = $wallet1Id
    } | ConvertTo-Json
    
    $result = Test-Endpoint -TestNum "10" -Description "Register service with BSV" `
        -Uri "$baseUrl/api/services" -Method POST `
        -Headers @{"X-API-Key"=$apiKey1} -Body $serviceBody `
        -Validation { param($c) $json = $c | ConvertFrom-Json; $json.id -and $json.name -eq "TestService" }
    $results += $result
    
    if ($result.Status -eq "PASS") {
        $service1Data = $result.Response | ConvertFrom-Json
        $service1Id = $service1Data.id
        Write-Host "  Service1 ID: $service1Id" -ForegroundColor Gray
    }
}

if ($wallet2Id -and $apiKey2) {
    $serviceBody2 = @{
        name = "MNEEService"
        description = "A MNEE service"
        price = 50
        currency = "MNEE"
        endpoint = "https://example.com/api2"
        category = "test"
        agentId = $wallet2Id
    } | ConvertTo-Json
    
    $result = Test-Endpoint -TestNum "11" -Description "Register service with MNEE" `
        -Uri "$baseUrl/api/services" -Method POST `
        -Headers @{"X-API-Key"=$apiKey2} -Body $serviceBody2 `
        -Validation { param($c) $json = $c | ConvertFrom-Json; $json.currency -eq "MNEE" }
    $results += $result
    
    if ($result.Status -eq "PASS") {
        $service2Data = $result.Response | ConvertFrom-Json
        $service2Id = $service2Data.id
    }
}

$result = Test-Endpoint -TestNum "12" -Description "List all services" `
    -Uri "$baseUrl/api/services" -Method GET `
    -Validation { param($c) $json = $c | ConvertFrom-Json; $json.Count -gt 0 }
$results += $result

$result = Test-Endpoint -TestNum "13" -Description "Search services by name" `
    -Uri "$baseUrl/api/services?search=test" -Method GET
$results += $result

if ($service1Id) {
    $result = Test-Endpoint -TestNum "14" -Description "GET service details" `
        -Uri "$baseUrl/api/services/$service1Id" -Method GET `
        -Validation { param($c) $json = $c | ConvertFrom-Json; $json.id -eq $service1Id }
    $results += $result
}

# Phase 4: Execution
Write-Host "`n=== PHASE 4: EXECUTION ===" -ForegroundColor Yellow

if ($service1Id -and $wallet1Id) {
    $executeBody = @{
        buyerWalletId = $wallet1Id
        input = @{ text = "hello" }
    } | ConvertTo-Json
    
    $result = Test-Endpoint -TestNum "15" -Description "Execute service" `
        -Uri "$baseUrl/api/execute/$service1Id" -Method POST -Body $executeBody
    $results += $result
    
    if ($result.Status -eq "PASS" -or $result.Response) {
        try {
            $execData = $result.Response | ConvertFrom-Json
            $paymentId = $execData.payment.id
            Write-Host "  Payment ID: $paymentId" -ForegroundColor Gray
            
            if ($paymentId) {
                $result = Test-Endpoint -TestNum "16" -Description "GET payment details" `
                    -Uri "$baseUrl/api/payments/$paymentId" -Method GET
                $results += $result
                
                $result = Test-Endpoint -TestNum "17" -Description "GET execution receipt" `
                    -Uri "$baseUrl/api/receipts/$paymentId" -Method GET
                $results += $result
                
                $result = Test-Endpoint -TestNum "18" -Description "Verify receipt" `
                    -Uri "$baseUrl/api/receipts/$paymentId/verify" -Method GET
                $results += $result
            }
        } catch {
            Write-Host "  Skipping payment/receipt tests - no payment ID" -ForegroundColor Yellow
        }
    }
}

# Phase 5: Disputes
Write-Host "`n=== PHASE 5: DISPUTES ===" -ForegroundColor Yellow

if ($paymentId -and $apiKey1) {
    $disputeBody = @{
        paymentId = $paymentId
        reason = "Bad output"
    } | ConvertTo-Json
    
    $result = Test-Endpoint -TestNum "19" -Description "Create dispute" `
        -Uri "$baseUrl/api/disputes" -Method POST `
        -Headers @{"X-API-Key"=$apiKey1} -Body $disputeBody
    $results += $result
    
    if ($result.Status -eq "PASS") {
        try {
            $disputeData = $result.Response | ConvertFrom-Json
            $disputeId = $disputeData.id
            
            if ($disputeId) {
                $result = Test-Endpoint -TestNum "20" -Description "GET dispute details" `
                    -Uri "$baseUrl/api/disputes/$disputeId" -Method GET
                $results += $result
            }
        } catch {}
    }
}

$result = Test-Endpoint -TestNum "21" -Description "List all disputes" `
    -Uri "$baseUrl/api/disputes" -Method GET
$results += $result

# Phase 6: Webhooks
Write-Host "`n=== PHASE 6: WEBHOOKS ===" -ForegroundColor Yellow

if ($apiKey1) {
    $webhookBody = @{
        url = "https://example.com/webhook"
        events = @("payment.completed")
        secret = "test123"
    } | ConvertTo-Json
    
    $result = Test-Endpoint -TestNum "22" -Description "Create webhook" `
        -Uri "$baseUrl/api/webhooks" -Method POST `
        -Headers @{"X-API-Key"=$apiKey1} -Body $webhookBody
    $results += $result
    
    if ($result.Status -eq "PASS") {
        try {
            $webhookData = $result.Response | ConvertFrom-Json
            $webhookId = $webhookData.id
        } catch {}
    }
    
    $result = Test-Endpoint -TestNum "23" -Description "List webhooks" `
        -Uri "$baseUrl/api/webhooks" -Method GET -Headers @{"X-API-Key"=$apiKey1}
    $results += $result
    
    if ($webhookId) {
        $result = Test-Endpoint -TestNum "24" -Description "Delete webhook" `
            -Uri "$baseUrl/api/webhooks/$webhookId" -Method DELETE -Headers @{"X-API-Key"=$apiKey1}
        $results += $result
    }
}

# Phase 7: Documentation
Write-Host "`n=== PHASE 7: DOCUMENTATION ===" -ForegroundColor Yellow

$result = Test-Endpoint -TestNum "25" -Description "GET Swagger UI" `
    -Uri "$baseUrl/docs" -Method GET `
    -Validation { param($c) $c -match "swagger" -or $c -match "Swagger" -or $c -match "<!DOCTYPE" }
$results += $result

$result = Test-Endpoint -TestNum "26" -Description "GET OpenAPI JSON" `
    -Uri "$baseUrl/docs/openapi.json" -Method GET `
    -Validation { param($c) $json = $c | ConvertFrom-Json; $json.openapi -or $json.swagger }
$results += $result

$result = Test-Endpoint -TestNum "27" -Description "GET OpenAPI YAML" `
    -Uri "$baseUrl/docs/openapi.yaml" -Method GET `
    -Validation { param($c) $c -match "openapi:" -or $c -match "swagger:" }
$results += $result

# Phase 8: Health
Write-Host "`n=== PHASE 8: HEALTH ===" -ForegroundColor Yellow

$result = Test-Endpoint -TestNum "28" -Description "Health check" `
    -Uri "$baseUrl/api/health" -Method GET `
    -Validation { param($c) $json = $c | ConvertFrom-Json; $json.ok -eq $true }
$results += $result

# Phase 9: Edge Cases
Write-Host "`n=== PHASE 9: EDGE CASES ===" -ForegroundColor Yellow

if ($wallet1Id -and $apiKey1) {
    $result = Test-Endpoint -TestNum "29" -Description "Fund with negative amount (should fail)" `
        -Uri "$baseUrl/api/wallets/$wallet1Id/fund" -Method POST `
        -Headers @{"X-API-Key"=$apiKey1} -Body '{"amount": -1}' -ExpectedStatus "400"
    $results += $result
    
    $result = Test-Endpoint -TestNum "30" -Description "Fund with zero amount (should fail)" `
        -Uri "$baseUrl/api/wallets/$wallet1Id/fund" -Method POST `
        -Headers @{"X-API-Key"=$apiKey1} -Body '{"amount": 0}' -ExpectedStatus "400"
    $results += $result
}

if ($apiKey1 -and $wallet1Id) {
    $result = Test-Endpoint -TestNum "31" -Description "Create service with empty name (should fail)" `
        -Uri "$baseUrl/api/services" -Method POST `
        -Headers @{"X-API-Key"=$apiKey1} -Body '{"name":"","description":"test","price":10,"currency":"BSV","endpoint":"https://test.com","category":"test","agentId":"'+ $wallet1Id +'"}' `
        -ExpectedStatus "400"
    $results += $result
    
    $result = Test-Endpoint -TestNum "32" -Description "Create service with negative price (should fail)" `
        -Uri "$baseUrl/api/services" -Method POST `
        -Headers @{"X-API-Key"=$apiKey1} -Body '{"name":"Test","description":"test","price":-1,"currency":"BSV","endpoint":"https://test.com","category":"test","agentId":"'+ $wallet1Id +'"}' `
        -ExpectedStatus "400"
    $results += $result
}

$result = Test-Endpoint -TestNum "34" -Description "Invalid JSON body (should 400)" `
    -Uri "$baseUrl/api/services" -Method POST `
    -Headers @{"X-API-Key"=$apiKey1; "Content-Type"="application/json"} -Body '{invalid json}' `
    -ExpectedStatus "400"
$results += $result

# Summary
Write-Host "`n`n=== TEST SUMMARY ===" -ForegroundColor Yellow
$passed = ($results | Where-Object { $_.Status -eq "PASS" }).Count
$failed = ($results | Where-Object { $_.Status -eq "FAIL" }).Count
$total = $results.Count

Write-Host "Total: $total | Passed: $passed | Failed: $failed" -ForegroundColor Cyan
Write-Host "Success Rate: $([math]::Round(($passed/$total)*100, 2))%`n"

# Export results
$results | Export-Csv -Path "D:\agentspay\test-results.csv" -NoTypeInformation
Write-Host "Results exported to D:\agentspay\test-results.csv"

# Return for report generation
return $results
