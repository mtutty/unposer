// Relative path — nginx proxies /api (and /ws) to the backend in both dev and production
// (see nginx/nginx.conf, nginx/nginx.dev.conf), so the same build works unmodified either way.
export const environment = {
  production: false,
  apiUrl: '/api'
};
