class ContractValidationError extends TypeError {
    constructor(code = 'INVALID_PAYLOAD') {
        super(code === 'UNKNOWN_HANDLER' ? 'Message type is not defined in the contract.' : 'Payload does not match the socket contract.');
        this.name = 'ContractValidationError';
        this.code = code;
    }
}

// Only errors from the inbound validation stage should be reported as a bad client payload.
class InboundContractValidationError extends ContractValidationError {}

module.exports = { ContractValidationError, InboundContractValidationError };
