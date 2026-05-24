const port = process.env.ROUNDTABLE_PORT ?? '4319'
const backendUrl = process.env.ROUNDTABLE_BACKEND_URL ?? `http://localhost:${port}`
const healthUrl = `${backendUrl.replace(/\/$/, '')}/api/health`
const timeoutAt = Date.now() + 30_000

while (Date.now() < timeoutAt) {
  try {
    const response = await fetch(healthUrl)
    if (response.ok) process.exit(0)
  } catch {
    // The backend may still be reconciling persisted room state.
  }
  await new Promise((resolve) => setTimeout(resolve, 100))
}

console.error(`Timed out waiting for backend health endpoint: ${healthUrl}`)
process.exit(1)
