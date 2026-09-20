const BASE = '/api';

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const getToken = () => sessionStorage.getItem('admin_token');
export const setToken = (t) => (t ? sessionStorage.setItem('admin_token', t) : sessionStorage.removeItem('admin_token'));
const adminHeaders = () => ({ Authorization: `Bearer ${getToken() || ''}` });

export const api = {
  health: () => request('/health'),
  status: () => request('/draw/status'),
  participants: (all = false) => request(`/participants${all ? '?all=1' : ''}`),
  winners: () => request('/winners'),
  audit: (id) => request(`/winners/audit/${id}`),
  auditAll: () => request('/winners/audit'),
  draw: (drawKey, count = 1, extra = {}) => request('/draw', { method: 'POST', body: { count, ...extra }, headers: { 'x-draw-key': drawKey } }),
  commit: (drawKey) => request('/draw/commit', { method: 'POST', headers: { 'x-draw-key': drawKey } }),
  archive: () => request('/winners/archive'),

  login: (password) => request('/auth/login', { method: 'POST', body: { password } }),
  me: () => request('/auth/me', { headers: adminHeaders() }),
  updateProfile: (display_name) => request('/auth/me', { method: 'PATCH', body: { display_name }, headers: adminHeaders() }),
  changePassword: (body) => request('/auth/change-password', { method: 'POST', body, headers: adminHeaders() }),
  addParticipant: (p) => request('/participants', { method: 'POST', body: p, headers: adminHeaders() }),
  bulkImport: (names) => request('/participants/bulk', { method: 'POST', body: { names }, headers: adminHeaders() }),
  importFile: async (file, { replace = false } = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    if (replace) fd.append('replace', '1');
    const res = await fetch(BASE + '/participants/import', { method: 'POST', body: fd, headers: adminHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail ? `${data.error}\n${data.detail}` : data.error || `HTTP ${res.status}`);
    return data;
  },
  removeParticipant: (id) => request(`/participants/${id}`, { method: 'DELETE', headers: adminHeaders() }),
  removeAllParticipants: () => request('/participants', { method: 'DELETE', headers: adminHeaders() }),
  reset: (note) => request('/admin/reset', { method: 'POST', body: { note }, headers: adminHeaders() }),
  clearArchive: () => request('/admin/archive', { method: 'DELETE', headers: adminHeaders() }),
  deleteArchivedSession: (id) => request(`/admin/archive/${id}`, { method: 'DELETE', headers: adminHeaders() }),
};
