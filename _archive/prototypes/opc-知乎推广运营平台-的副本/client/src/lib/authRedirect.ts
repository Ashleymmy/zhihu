export function getAuthenticatedLandingPath(isAuthenticated: boolean, loading: boolean) {
  return isAuthenticated && !loading ? "/dashboard/overview" : null;
}
