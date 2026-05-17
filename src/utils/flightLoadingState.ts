type FlightLoadingStateInput = {
  isLoading: boolean;
  hasVisibleFlights: boolean;
};

type FlightRefreshIndicatorInput = FlightLoadingStateInput & {
  isRefreshing: boolean;
};

export function shouldShowBlockingFlightLoader({
  isLoading,
  hasVisibleFlights,
}: FlightLoadingStateInput): boolean {
  return isLoading && !hasVisibleFlights;
}

export function shouldShowFlightRefreshIndicator({
  isLoading,
  isRefreshing,
  hasVisibleFlights,
}: FlightRefreshIndicatorInput): boolean {
  return hasVisibleFlights && (isLoading || isRefreshing);
}
