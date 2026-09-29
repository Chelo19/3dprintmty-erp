import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./http/auth.guard";
import { HealthController } from "./http/health.controller";
import { AuthController } from "./modules/auth.controller";
import { CatalogController } from "./modules/catalog.controller";
import { DashboardController } from "./modules/dashboard.controller";
import { ManufacturingController } from "./modules/manufacturing.controller";
import { OnboardingController } from "./modules/onboarding.controller";
import { OperationsController } from "./modules/operations.controller";
import { OrdersController } from "./modules/orders.controller";
import { PlatformController } from "./modules/platform.controller";
import { PrefacturasController } from "./modules/prefacturas.controller";
import { ProductionController } from "./modules/production.controller";
import { PurchasingController } from "./modules/purchasing.controller";
import { SettingsController } from "./modules/settings.controller";
import { TeamController } from "./modules/team.controller";

@Module({
  controllers: [
    HealthController,
    AuthController,
    OnboardingController,
    CatalogController,
    OperationsController,
    OrdersController,
    SettingsController,
    TeamController,
    PlatformController,
    DashboardController,
    ManufacturingController,
    ProductionController,
    PurchasingController,
    PrefacturasController,
  ],
  providers: [AuthGuard, { provide: APP_GUARD, useExisting: AuthGuard }],
})
export class AppModule {}
