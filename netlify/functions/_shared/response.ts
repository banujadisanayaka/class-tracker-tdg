export function ok<T>(data: T, requestId: string) {
  return Response.json({ success: true, requestId, data }, { status: 200 });
}

export function fail(code: string, message: string, requestId: string, status = 400) {
  return Response.json({ success: false, requestId, error: { code, message } }, { status });
}
