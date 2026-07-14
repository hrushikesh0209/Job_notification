const GENERIC_JOB_BOARDS = [
  {
    company: /^linkedin$/i,
    hostname: /^(?:www\.)?linkedin\.com$/i,
    pathname: /^\/jobs\/search\/?$/i,
  },
];

export function isAllowedOfficialPortal(record) {
  let url;
  try {
    url = new URL(record.portalUrl);
  } catch {
    return false;
  }

  return !GENERIC_JOB_BOARDS.some((rule) =>
    rule.company.test(record.company)
      && rule.hostname.test(url.hostname)
      && rule.pathname.test(url.pathname));
}

