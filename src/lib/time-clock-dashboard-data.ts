export type DashboardRequestResult<T> =
  | { success: true; data: T }
  | { success: false }

export type DashboardFetcher = (url: string) => Promise<{
  ok: boolean
  json: () => Promise<unknown>
}>

export async function fetchDashboardJson<T>(
  url: string,
  fetcher: DashboardFetcher = (requestUrl) => fetch(requestUrl),
): Promise<DashboardRequestResult<T>> {
  try {
    const response = await fetcher(url)
    if (!response.ok) return { success: false }
    return { success: true, data: (await response.json()) as T }
  } catch {
    return { success: false }
  }
}
