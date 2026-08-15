export function isProductionEnvironment(value: string | undefined) {
  return value === "production" || value === "prod";
}

export function isResetForTestingAllowed(value: string | undefined, hostname: string) {
  const environment = value?.trim().toLowerCase();
  if (isProductionEnvironment(environment)) return false;
  if (environment === "development" || environment === "dev" || environment === "staging" || environment === "stg") {
    return true;
  }

  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}
