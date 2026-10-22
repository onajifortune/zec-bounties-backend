// Browsers hand out push endpoints only on these services. Any other URL in a
// subscription would make the server send requests to a host the user chose.
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com"];
const PUSH_HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];

function isAllowedPushEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) {
    return false;
  }
  return (
    PUSH_HOSTS.includes(url.hostname) ||
    PUSH_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix))
  );
}

module.exports = { isAllowedPushEndpoint };
