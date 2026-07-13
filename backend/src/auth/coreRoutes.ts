import type { RegisterCoreRoutesDeps } from "./coreRouteTypes";
import { registerRegistrationRoute } from "./coreRegistrationRoute";
import { registerLoginRoute } from "./coreLoginRoute";
import { registerSessionRoutes } from "./coreSessionRoutes";
import { registerSetupRoutes } from "./coreSetupRoutes";

export type { RegisterCoreRoutesDeps } from "./coreRouteTypes";

export const registerCoreRoutes = (deps: RegisterCoreRoutesDeps) => {
  registerRegistrationRoute(deps);
  registerLoginRoute(deps);
  registerSessionRoutes(deps);
  registerSetupRoutes(deps);
};
