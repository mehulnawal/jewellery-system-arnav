import { createContext, useContext } from "react";
export const BusinessAvailabilityContext = createContext({
  phase: "loading",
  record: null,
});
export const useBusinessAvailability = () =>
  useContext(BusinessAvailabilityContext);
