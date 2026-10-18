// Backend API Service

export async function apiRequest(action, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`api.php?action=${action}`, options);
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || 'Server error');
  }
  return data;
}
