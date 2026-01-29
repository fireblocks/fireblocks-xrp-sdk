import {
  Amount,
  Memo,
  Payment,
  AccountSet,
  TrustSet,
  IssuedCurrencyAmount,
  Clawback,
  PaymentFlags,
  isValidAddress,
  Path,
} from "xrpl";
import {
  IPaymentFlags,
  ITrustSetFlags,
  AccountSetConfig,
} from "../config/types";
import { TrustSetFlagValues } from "../utils/constants";
import {
  deriveAccountSetAsf,
  deriveAccountSetTf,
  hexEncodeDomain,
  validateAmount,
  derivePaymentFlags,
  validateMemos,
} from "../utils/utils";
import { ValidationError } from "../errors/errors";

export class TokenService {
  /**
   * Payment transaction creation, should be used for token transfers and burn txs. for CrossCurrencyPayments, use the relevant method instead.
   * @param address - account address
   * @param destination - destination address
   * @param amount - amount to send.
   * @param fee - fee in drops, automatically calculated by the SDK
   * @param sequence - sequence number, automatically fetched by the SDK
   * @param lastLedgerSequence - TTL: last ledger sequence, automatically calculated by the SDK
   * @param flags - optional flags for payment transaction
   * @param memos - optional memos for payment transaction
   * @param destinationTag - optional destination tag for payment transaction
   * @param invoiceId - optional invoice ID for payment transaction
   * @param sendMax - optional Amount to set as SendMax
   * @param deliverMin - optional Amount to set as DeliverMin
   * @returns Payment transaction object
   */
  public createFungibleTokenPaymentTx = (
    address: string,
    destination: string,
    amount: Amount,
    fee: string,
    sequence: number,
    lastLedgerSequence: number,
    flags?: IPaymentFlags,
    memos?: Memo[],
    destinationTag?: number,
    invoiceId?: string,
    sendMax?: Amount,
    deliverMin?: Amount,
    paths?: Path[]
  ): Payment => {
    try {
      const { tfPartialPayment } = PaymentFlags;

      // Validate destination
      if (!isValidAddress(destination)) {
        throw new ValidationError(
          "InvalidDestination",
          `Invalid destination address: ${destination}`
        );
      }
      if (typeof amount === "string") {
        throw new ValidationError(
          "InvalidAmount",
          "Should not use transferToken method for XRP payments"
        );
      }

      // Validate Amount
      validateAmount("Amount", amount);

      // Validate destinationTag
      if (destinationTag !== undefined) {
        if (
          !Number.isInteger(destinationTag) ||
          destinationTag < 0 ||
          destinationTag > 0xffffffff
        ) {
          throw new ValidationError(
            "InvalidDestinationTag",
            "DestinationTag must be an integer between 0 and 2^32–1."
          );
        }
      }

      // Validate invoiceId
      if (invoiceId !== undefined) {
        if (!/^[A-Fa-f0-9]{64}$/.test(invoiceId)) {
          throw new ValidationError(
            "InvalidInvoiceId",
            "InvoiceID must be a 32-byte (64-hex) string."
          );
        }
      }

      // Validate memos
      if (memos !== undefined && !Array.isArray(memos)) {
        throw new ValidationError(
          "InvalidMemos",
          "Memos must be an array of Memo objects."
        );
      }

      // validate SendMax and DeliverMin if they are provided
      if (sendMax !== undefined) validateAmount("SendMax", sendMax);
      if (deliverMin !== undefined) validateAmount("DeliverMin", deliverMin);

      // Derive & validate flags if they are provided
      const combinedFlags = flags ? derivePaymentFlags(flags) : undefined;

      const wantsPartial = Boolean((combinedFlags ?? 0) & tfPartialPayment);

      // Ensure partial flag when using SendMax or DeliverMin
      if (
        !wantsPartial &&
        (sendMax !== undefined || deliverMin !== undefined)
      ) {
        throw new ValidationError(
          "InvalidFlags",
          "SendMax or DeliverMin requires the tfPartialPayment flag."
        );
      }

      // Build payload
      const tx: Payment = {
        TransactionType: "Payment",
        Account: address,
        Destination: destination,
        Amount: amount,
        Fee: fee,
        Sequence: sequence,
        LastLedgerSequence: lastLedgerSequence,
        ...(combinedFlags !== undefined && { Flags: combinedFlags }),
        ...(memos && memos.length > 0 && { Memos: memos }),
        ...(destinationTag !== undefined && { DestinationTag: destinationTag }),
        ...(invoiceId !== undefined && { InvoiceID: invoiceId }),
        ...(sendMax !== undefined && { SendMax: sendMax }),
        ...(deliverMin !== undefined && { DeliverMin: deliverMin }),
        ...(paths !== undefined && { Paths: paths }),
      };

      return tx;
    } catch (error: any) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new Error(`Error creating a Payment transaction: ${error.message}`);
    }
  };

  /**
   * TrustSet transaction payload creation method.
   * @param address - Account address
   * @param fee - Fee in drops, automatically calculated by the SDK
   * @param sequence - Sequence number, automatically fetched by the SDK
   * @param limitAmount - IssuedCurrencyAmount object
   * @param lastLedgerSequence - TTL: last ledger sequence, automatically calculated by the SDK
   * @param flags - Optional trustline flags
   * @param qualityIn - Optional integer > 0
   * @param qualityOut - Optional integer > 0
   * @param memos - Optional memos for the transaction
   * @returns TrustSet transaction object
   */
  public createTrustSetTx = (
    address: string,
    fee: string,
    sequence: number,
    limitAmount: IssuedCurrencyAmount,
    lastLedgerSequence: number,
    flags?: ITrustSetFlags,
    qualityIn?: number,
    qualityOut?: number,
    memos?: Memo[]
  ): TrustSet => {
    // Validate address
    if (!isValidAddress(address)) {
      throw new ValidationError("InvalidHolder", `Invalid address: ${address}`);
    }

    // Allow zero values for TrustSet (required to delete trustlines)
    validateAmount("LimitAmount", limitAmount, true);

    // Validate qualityIn / qualityOut if provided
    if (qualityIn !== undefined || qualityOut !== undefined) {
      const qualities: [string, number | undefined][] = [
        ["QualityIn", qualityIn],
        ["QualityOut", qualityOut],
      ];
      for (const [name, val] of qualities) {
        if (val !== undefined) {
          if (!Number.isInteger(val) || val <= 0 || val > 0xffffffff) {
            throw new ValidationError(
              "InvalidQuality",
              `Invalid ${name}: must be an integer between 1 and 2^32-1.`
            );
          }
        }
      }
    }

    // Flags → bitmask, with mutual-exclusion guards
    let combinedFlags = 0;
    if (flags) {
      // Can't both set and clear NoRipple
      if (flags.tfSetNoRipple && flags.tfClearNoRipple) {
        throw new Error(
          "Cannot both set and clear NoRipple on same trust line."
        );
      }
      // Can't both set and clear Freeze
      if (flags.tfSetFreeze && flags.tfClearFreeze) {
        throw new ValidationError(
          "InvalidFlags",
          "Cannot both set and clear Freeze on same trust line."
        );
      }

      for (const [key, on] of Object.entries(flags) as [
        keyof ITrustSetFlags,
        boolean
      ][]) {
        if (on) {
          combinedFlags |= TrustSetFlagValues[key];
        }
      }
    }

    // Build payload
    const tx: TrustSet = {
      TransactionType: "TrustSet",
      Account: address,
      Fee: fee,
      Sequence: sequence,
      LastLedgerSequence: lastLedgerSequence,
      LimitAmount: limitAmount,
      ...(combinedFlags && { Flags: combinedFlags }),
      ...(qualityIn !== undefined && { QualityIn: qualityIn }),
      ...(qualityOut !== undefined && { QualityOut: qualityOut }),
      ...(memos && memos.length > 0 && { Memos: memos }),
    };

    return tx;
  };

  /**
   * AccountSet payload creation function -> will derive the flags and other fields. if more then one SetFlag or ClearFlag is provided, it will throw an error.
   * @param address - account address, sdk.address
   * @param fee - fee in drops, automatically calculated by the SDK
   * @param sequence - sequence number, automatically fetched by the SDK
   * @param lastLedgerSequence - TTL: last ledger sequence, automatically calculated by the SDK
   * @param configs - AccountSetConfig object containing flags and optional fields
   * @param memos - optional memos for the transaction
   * @throws ValidationError if address is invalid, or if any of the configs are invalid
   * @returns AccountSet transaction object
   */
  public createAccountSetTx = (
    address: string,
    fee: string,
    sequence: number,
    lastLedgerSequence: number,
    configs: AccountSetConfig,
    memos?: Memo[]
  ): AccountSet => {
    // ASF flags → SetFlag / ClearFlag
    const { SetFlag, ClearFlag } = deriveAccountSetAsf(
      configs.setFlag,
      configs.clearFlag
    );

    // TF flags → Flags
    const Flags = deriveAccountSetTf(configs.tfFlags);

    // Optional fields
    const domain = configs.domain ? hexEncodeDomain(configs.domain) : undefined;
    if (
      configs.transferRate !== undefined &&
      (configs.transferRate < 1e9 || configs.transferRate > 2e9)
    ) {
      throw new ValidationError(
        "InvalidTransferRate",
        "transferRate must be between 1e9 and 2e9"
      );
    }
    if (
      configs.tickSize !== undefined &&
      (configs.tickSize < 3 || configs.tickSize > 15)
    ) {
      throw new ValidationError(
        "InvalidTickSize",
        "tickSize must be between 3 and 15"
      );
    }
    if (
      configs.emailHash !== undefined &&
      !/^[A-Fa-f0-9]{32}$/.test(configs.emailHash)
    ) {
      throw new ValidationError(
        "InvalidEmailHash",
        "emailHash must be 32 hex chars"
      );
    }
    if (
      configs.messageKey !== undefined &&
      !/^(?:02|03|ED)[A-Fa-f0-9]{64}$/.test(configs.messageKey)
    ) {
      throw new ValidationError(
        "InvalidMessageKey",
        "messageKey must be 66 hex chars with valid prefix"
      );
    }

    // Validate and process memos if provided
    const validatedMemos = memos ? validateMemos(memos) : undefined;

    return {
      TransactionType: "AccountSet",
      Account: address,
      Fee: fee,
      Sequence: sequence,
      LastLedgerSequence: lastLedgerSequence,
      ...(SetFlag !== undefined && { SetFlag }),
      ...(ClearFlag !== undefined && { ClearFlag }),
      ...(Flags !== undefined && { Flags }),
      ...(domain !== undefined && { Domain: domain }),
      ...(configs.transferRate !== undefined && {
        TransferRate: configs.transferRate,
      }),
      ...(configs.tickSize !== undefined && { TickSize: configs.tickSize }),
      ...(configs.emailHash !== undefined && { EmailHash: configs.emailHash }),
      ...(configs.messageKey !== undefined && {
        MessageKey: configs.messageKey,
      }),
      ...(validatedMemos && validatedMemos.length > 0
        ? { Memos: validatedMemos }
        : {}),
    };
  };

  /**
   * method to create a Clawback transaction payload
   * @param holder - issuer address
   * @param amount - amount to clawback, issuer in the amount is the token holder
   * @param fee - fee in drops, automatically calculated by the SDK
   * @param sequence - sequence number, automatically fetched by the SDK
   * @param lastLedgerSequence - TTL: last ledger sequence, automatically calculated by the SDK
   * @param memos - optional memos for the transaction
   * @param destinationTag - optional destination tag for the transaction
   * @param invoiceId - optional invoice ID for the transaction
   * @returns Clawback transaction object
   */
  public createClawbackTx = (
    address: string,
    amount: IssuedCurrencyAmount,
    fee: string,
    sequence: number,
    lastLedgerSequence: number,
    memos?: Memo[]
  ): Clawback => {
    // Validate issuer
    if (!isValidAddress(amount.issuer)) {
      throw new ValidationError(
        "InvalidAddress",
        `Invalid token holder address: ${amount.issuer}`
      );
    }
    // Validate and process memos if provided
    const validatedMemos = memos ? validateMemos(memos) : undefined;

    // Validate Amount
    validateAmount("amount", amount);

    const tx: Clawback = {
      TransactionType: "Clawback",
      Account: address,
      Amount: amount,
      Fee: fee,
      LastLedgerSequence: lastLedgerSequence,
      Sequence: sequence,
      ...(validatedMemos && validatedMemos.length > 0
        ? { Memos: validatedMemos }
        : {}),
    };
    return tx;
  };
}
