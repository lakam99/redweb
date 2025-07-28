// handlers/SocketService.js
class SocketService {
    /**
     * @param {string} name            – service identifier
     * @param {?number} tickRateMs     – optional tick interval (ms)
     */
    constructor(name, tickRateMs = null) {
      this.name        = name;
      this.tickRateMs  = tickRateMs;
      this._tickHandle = null;
    }
  
    /**
     * Called once by the owning SocketRoute.
     * @param {import('../SocketRoute')} route – the route this service belongs to
     */
    onInit(route) {
      this.route = route;                        // full access to route, clients, broadcast…
      if (this.tickRateMs && this.onTick) {
        this._tickHandle = setInterval(() => this.onTick(), this.tickRateMs);
      }
    }
  
    /* Optional */
    // onTick() {}
  
    onShutdown() {
      if (this._tickHandle) clearInterval(this._tickHandle);
    }
  }
  
  module.exports = SocketService;
  