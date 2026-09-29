import { Controller, Get } from "@nestjs/common";
import { services } from "../container";
import { Public } from "./auth.guard";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  health() {
    return { ok: true, driver: services().database.driver };
  }
}
