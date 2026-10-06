import DOMPurify from 'dompurify';

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  const href = node.nodeName === 'A' ? node.getAttribute('href') : null;
  if (!href) return;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return;
  }
  if (!/^https?:$/.test(url.protocol) || url.origin === window.location.origin) return;
  node.setAttribute('target', '_blank');
  node.setAttribute('rel', 'noopener noreferrer');
});

export default DOMPurify;
