import type { PageType } from '~/interfaces';

export function getPageFromPath(pathname: string): PageType {
  if (pathname === '/') return 'iterations';
  if (pathname === '/join') return 'join';
  if (pathname.match(/^\/iteration\/\d+\/project\/[^/]+(?:\/edit)?$/)) return 'project';
  if (pathname.match(/^\/iteration\/\d+(?:\/details(?:\/edit)?)?$/)) return 'iteration';
  if (pathname === '/badges') return 'badges';
  if (pathname.match(/^\/certs\/request\/\d+$/)) return 'cert-request';
  if (pathname.match(/^\/certs\/review\/\d+$/)) return 'cert-review';
  if (pathname === '/certs') return 'certs';
  if (pathname.match(/^\/cert\/\d+\/\d+$/)) return 'cert';
  if (pathname.match(/^\/profile\/[^/]+$/)) return 'profile';
  if (pathname === '/get-address') return 'get-address';
  if (pathname === '/faq') return 'faq';
  if (pathname === '/privacy') return 'privacy';
  if (pathname === '/terms') return 'terms';
  return 'not-found';
}
