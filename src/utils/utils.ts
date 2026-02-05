import {
  AccountSetAsfFlags,
  AccountSetTfFlags,
  Amount,
  Client,
  IssuedCurrencyAmount,
  Memo,
  OfferCreateFlags,
  PaymentFlags,
} from "xrpl";
import { isValidAddress } from "xrpl";
import { ClientError, ValidationError } from "../errors/errors";
import {
  AsfFlags,
  IOfferCreateFlags,
  IPaymentFlags,
  NetworkParams,
  TfFlags,
} from "../config/types";
import { MAX_DOMAIN_BYTES, TTL_CONST, XRP_LIMITS } from "./constants";

const HASHREGEX = /^[0-9A-Fa-f]{64}$/;
/**
 * Estimate the current network fee based on server state.
 */
export const estimateNetworkFees = async (client: Client): Promise<string> => {
  try {
    const response = await client.request({
      id: 2,
      command: "server_state",
      ledger_index: "current",
    });

    const state = response.result?.state;

    if (!state) {
      throw new ClientError(
        "XrpClientError",
        "No server state response received"
      );
    }

    const { validated_ledger, load_factor, load_base } = state;

    if (!validated_ledger?.base_fee || !load_factor || !load_base) {
      throw new ClientError(
        "XrpClientError",
        "Server state missing required fields: base_fee, load_factor, or load_base"
      );
    }

    const estimatedFee = (validated_ledger.base_fee * load_factor) / load_base;
    return estimatedFee.toString();
  } catch (error) {
    if (error instanceof ClientError) {
      throw error;
    }
    throw new Error(
      `Failed to estimate network fees: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

/**
 * Fetches the account sequence and current ledger index.
 */
export const getAccountAndLedgerSequences = async (
  client: Client,
  address: string
): Promise<{ sequence: number; ledgerCurrentIndex: number }> => {
  try {
    if (!address || typeof address !== "string") {
      throw new ValidationError("InvalidAddress", "Invalid address provided");
    }

    const response = await client.request({
      command: "account_info",
      account: address,
      ledger_index: "current",
    });

    const result = response.result;

    if (!result?.account_data?.Sequence || !result?.ledger_current_index) {
      throw new ClientError(
        "XrpClientError",
        "Account info response missing required data: Sequence or ledger_current_index"
      );
    }

    return {
      sequence: result.account_data.Sequence,
      ledgerCurrentIndex: result.ledger_current_index,
    };
  } catch (error) {
    if (error instanceof ClientError || error instanceof ValidationError) {
      throw error;
    }
    throw new Error(
      `Failed to fetch account and ledger sequences: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

/**
 * Ensures client connection and handles reconnection if needed.
 */
export const ensureConnection = async (client: Client): Promise<void> => {
  try {
    if (!client.isConnected()) {
      await client.connect();
    }
  } catch (error) {
    throw new Error(
      `Failed to establish client connection: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

/**
 * Combines fee estimate and sequence info into network params.
 * This is the main function that orchestrates the network parameter gathering.
 */
export const getSequencesAndFee = async (
  client: Client,
  address: string
): Promise<NetworkParams> => {
  try {
    // Validate inputs
    if (!client) {
      throw new ValidationError("ClientError", "Client instance is required");
    }
    if (!address || typeof address !== "string") {
      throw new ValidationError(
        "InvalidAddress",
        "Valid address string is required"
      );
    }

    // Ensure connection
    await ensureConnection(client);

    // Fetch network parameters concurrently for better performance
    const [fee, { sequence, ledgerCurrentIndex }] = await Promise.all([
      estimateNetworkFees(client),
      getAccountAndLedgerSequences(client, address),
    ]);

    // Calculate TTL
    const lastLedgerSequence = ledgerCurrentIndex + TTL_CONST;

    return {
      fee,
      sequence,
      lastLedgerSequence,
    };
  } catch (error) {
    if (error instanceof ClientError || error instanceof ValidationError) {
      throw error;
    }
    throw new Error(
      `Failed to get network parameters: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

/**
 * Utility function to get network params with retry logic.
 * Useful for handling temporary network issues.
 */
export const getNetworkParams = async (
  client: Client,
  address: string,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<NetworkParams> => {
  let lastError: Error = new ClientError(
    "UnknownError",
    "Unknown client error occurred"
  );

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await getSequencesAndFee(client, address);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on validation errors
      if (error instanceof ValidationError) {
        throw error;
      }

      if (attempt === maxRetries) {
        break;
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt));
    }
  }

  throw new Error(
    `Failed to get network parameters after ${maxRetries} attempts: ${lastError.message}`
  );
};

/**
 * Derives a bitmask for OfferCreate flags from a flags object.
 * Validates that flags aren't conflicting and returns a proper bitmask.
 *
 * @param flags - Object containing boolean flags for OfferCreate transaction
 * @returns The combined bitmask or undefined if no flags are set
 * @throws {ValidationError} If mutually exclusive flags are set
 */
export const deriveOfferCreateFlags = (
  flags: IOfferCreateFlags
): number | undefined => {
  if (!flags) {
    return undefined;
  }

  // Validate for mutually exclusive flags
  if (flags.tfImmediateOrCancelOffer && flags.tfFillOrKillOffer) {
    throw new ValidationError(
      "InvalidFlags",
      "Cannot set both tfImmediateOrCancelOffer and tfFillOrKillOffer flags simultaneously"
    );
  }

  // Build the combined mask
  let combined = 0;
  if (flags.tfPassiveOffer) combined |= OfferCreateFlags.tfPassive;
  if (flags.tfImmediateOrCancelOffer)
    combined |= OfferCreateFlags.tfImmediateOrCancel;
  if (flags.tfFillOrKillOffer) combined |= OfferCreateFlags.tfFillOrKill;
  if (flags.tfSellOffer) combined |= OfferCreateFlags.tfSell;

  // Omit Flags entirely if zero
  return combined === 0 ? undefined : combined;
};

/**
 * Derives a bitmask for Payment flags from a flags object.
 *
 * @param flags - Object containing boolean flags for Payment transaction
 * @returns The combined bitmask or undefined if no flags are set
 */
export const derivePaymentFlags = (
  flags: IPaymentFlags
): number | undefined => {
  if (!flags) {
    return undefined;
  }

  let combined = 0;
  if (flags.tfNoRippleDirect) combined |= PaymentFlags.tfNoRippleDirect;
  if (flags.tfPartialPayment) combined |= PaymentFlags.tfPartialPayment;
  if (flags.tfLimitQuality) combined |= PaymentFlags.tfLimitQuality;

  return combined === 0 ? undefined : combined;
};

/**
 * Validates a hash256 string (64 hex chars).
 */
export function validateHash256(name: string, value: string) {
  if (typeof value !== "string" || !HASHREGEX.test(value)) {
    throw new ValidationError(
      "InvalidHash256",
      `${name} must be a 64-character hexadecimal string (hash256)`
    );
  }
}

/**
 * Validate an XRP or token Amount, throwing ValidationError on bad input.
 * Performs extensive validation to ensure amount is properly formatted and within allowed limits.
 *
 * @param name - Name of the amount field (used in error messages)
 * @param amt - The amount to validate (string for XRP, object for token)
 * @param allowZero - Optional flag to allow zero values (e.g., for TrustSet to delete trustlines)
 * @throws {ValidationError} If the amount is invalid
 */
export const validateAmount = (name: string, amt: Amount, allowZero: boolean = false): void => {
  // Check for null/undefined
  if (amt === null || amt === undefined) {
    throw new ValidationError(
      "MissingAmount",
      `${name} cannot be null or undefined`
    );
  }

  // Validate XRP amount (string of drops)
  if (typeof amt === "string") {
    // Must be a string of digits only
    if (!/^\d+$/.test(amt)) {
      throw new ValidationError(
        "InvalidAmount",
        `${name} as XRP must be a string of integer drops`
      );
    }

    try {
      // Validate amount is within allowed range
      const amountBigInt = BigInt(amt);

      if (amountBigInt <= 0n) {
        throw new ValidationError(
          "InvalidAmount",
          `${name} must have a positive amount as value`
        );
      }

      if (amountBigInt > BigInt(XRP_LIMITS.MAX_XRP)) {
        throw new ValidationError(
          "InvalidAmount",
          `${name} exceeds maximum possible XRP (100 billion)`
        );
      }
    } catch (error: any) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        "InvalidAmount",
        `${name} is not a valid XRP amount: ${error.message}`
      );
    }
  }
  // Validate token amount (object with currency, issuer, value)
  else if (typeof amt === "object") {
    if (!amt) {
      throw new ValidationError(
        "InvalidAmount",
        `${name} must be a non-null object for token amounts`
      );
    }

    const { currency, issuer, value } = amt as IssuedCurrencyAmount;

    // Check required fields exist
    if (!currency || !issuer || !value) {
      throw new ValidationError(
        "InvalidAmount",
        `${name} as token must include currency, issuer, and value`
      );
    }

    // Validate currency format (ISO code or hex)
    if (typeof currency !== "string") {
      throw new ValidationError(
        "InvalidAmount",
        `${name} currency must be a string`
      );
    }

    // Currency should be either a 3-character code or 40-character hex
    if (!/^[A-Za-z0-9]{3}$|^[0-9A-Fa-f]{40}$/.test(currency)) {
      throw new ValidationError(
        "InvalidAmount",
        `${name} currency must be a 3-character code or 40-character hex`
      );
    }

    // Validate issuer is a valid address
    if (typeof issuer !== "string" || !isValidAddress(issuer)) {
      throw new ValidationError(
        "InvalidAmount",
        `${name} issuer is not a valid XRPL address`
      );
    }

    // Validate value is a properly formatted number string
    if (typeof value !== "string" || !/^-?\d*\.?\d+$/.test(value)) {
      throw new ValidationError(
        "InvalidAmount",
        `${name} value must be a valid number string`
      );
    }

    // Validate value is positive (unless allowZero is true, which allows 0 for TrustSet deletion)
    const valueNum = parseFloat(value);
    if (!allowZero && valueNum <= 0) {
      throw new ValidationError(
        "InvalidAmount",
        `${name} must be a positive amount`
      );
    }
    if (allowZero && valueNum < 0) {
      throw new ValidationError(
        "InvalidAmount",
        `${name} cannot be negative`
      );
    }
  } else {
    throw new ValidationError(
      "InvalidAmount",
      `${name} must be a string (for XRP) or an object (for issued currency)`
    );
  }
};

/**
 * Validates a destination tag value.
 *
 * @param tag - The destination tag to validate
 * @throws {ValidationError} If the tag is invalid
 */
export const validateDestinationTag = (tag: number): void => {
  if (tag === undefined || tag === null) {
    return; // Optional parameter, no validation needed if not provided
  }

  if (
    typeof tag !== "number" ||
    !Number.isInteger(tag) ||
    tag < 0 ||
    tag > 0xffffffff
  ) {
    throw new ValidationError(
      "InvalidDestinationTag",
      "Destination tag must be a 32-bit unsigned integer"
    );
  }
};

/**
 * Validates a memo array.
 *
 * @param memos - Array of memo objects to validate
 * @returns The validated memo array
 * @throws {ValidationError} If any memo is invalid
 */
export const validateMemos = (memos: any[]): Memo[] | undefined => {
  if (!memos) {
    return undefined;
  }

  if (!Array.isArray(memos)) {
    throw new ValidationError("InvalidMemos", "Memos must be an array");
  }

  if (memos.length === 0) {
    return undefined;
  }

  return memos.map((memo) => {
    // Check if memo is an object
    if (!memo || typeof memo !== "object") {
      throw new ValidationError(
        "InvalidMemo",
        "Each memo must be a non-null object"
      );
    }

    // Check if at least one required field exists
    if (
      memo.MemoData === undefined &&
      memo.MemoType === undefined &&
      memo.MemoFormat === undefined
    ) {
      throw new ValidationError(
        "InvalidMemo",
        "Memo must contain at least one of: MemoData, MemoType, or MemoFormat"
      );
    }

    // Validate each field if present
    const validatedMemo: Memo = { Memo: {} };

    if (memo.MemoData !== undefined) {
      if (typeof memo.MemoData !== "string") {
        throw new ValidationError("InvalidMemo", "MemoData must be a string");
      }
      validatedMemo.Memo.MemoData = memo.MemoData;
    }

    if (memo.MemoType !== undefined) {
      if (typeof memo.MemoType !== "string") {
        throw new ValidationError("InvalidMemo", "MemoType must be a string");
      }
      validatedMemo.Memo.MemoType = memo.MemoType;
    }

    if (memo.MemoFormat !== undefined) {
      if (typeof memo.MemoFormat !== "string") {
        throw new ValidationError("InvalidMemo", "MemoFormat must be a string");
      }
      validatedMemo.Memo.MemoFormat = memo.MemoFormat;
    }

    return validatedMemo;
  });
};

/**
 * Map one ASF boolean → numeric SetFlag, and one ClearFlag, throwing ValidationError on misuse.
 */
export function deriveAccountSetAsf(
  set?: AsfFlags,
  clear?: AsfFlags
): { SetFlag?: number; ClearFlag?: number } {
  // mapping from flag key → asf numeric
  const map: Record<keyof AsfFlags, number> = {
    asfRequireAuth: AccountSetAsfFlags.asfRequireAuth,
    asfDefaultRipple: AccountSetAsfFlags.asfDefaultRipple,
    asfAllowTrustLineClawback: AccountSetAsfFlags.asfAllowTrustLineClawback,
    asfDisableMaster: AccountSetAsfFlags.asfDisableMaster,
    asfRequireDestTag: AccountSetAsfFlags.asfRequireDest,
    asfDisallowXRP: AccountSetAsfFlags.asfDisallowXRP,
  };

  // Exactly one true in set, one true in clear
  const setKeys = set
    ? (Object.keys(set) as (keyof AsfFlags)[]).filter((k) => set[k])
    : [];
  const clearKeys = clear
    ? (Object.keys(clear) as (keyof AsfFlags)[]).filter((k) => clear[k])
    : [];

  if (setKeys.length > 1)
    throw new ValidationError(
      "InvalidAsfFlags",
      `Cannot set more than one ASF flag: ${setKeys}`
    );
  if (clearKeys.length > 1)
    throw new ValidationError(
      "InvalidAsfFlags",
      `Cannot clear more than one ASF flag: ${clearKeys}`
    );

  return {
    SetFlag: setKeys[0] ? map[setKeys[0]] : undefined,
    ClearFlag: clearKeys[0] ? map[clearKeys[0]] : undefined,
  };
}

/**
 * Combine any TF booleans into the Flags bitmask.
 */
export function deriveAccountSetTf(tf?: TfFlags): number | undefined {
  if (!tf) return undefined;
  let mask = 0;
  const f = AccountSetTfFlags;
  if (tf.tfRequireDestTag) mask |= f.tfRequireDestTag;
  if (tf.tfOptionalDestTag) mask |= f.tfOptionalDestTag;
  if (tf.tfRequireAuth) mask |= f.tfRequireAuth;
  if (tf.tfOptionalAuth) mask |= f.tfOptionalAuth;
  if (tf.tfDisallowXRP) mask |= f.tfDisallowXRP;
  if (tf.tfAllowXRP) mask |= f.tfAllowXRP;
  return mask || undefined;
}

/**
 * Hex-encode a domain name for the AccountSet.Domain field.
 * @throws if >256 bytes when UTF-8 encoded.
 */
export function hexEncodeDomain(domain: string): string {
  if (!/^[\x00-\x7F]*$/.test(domain)) {
    throw new ValidationError("InvalidDomain", "Domain must be ASCII");
  }

  const hex = Buffer.from(domain, "utf8").toString("hex").toUpperCase();
  if (hex.length > MAX_DOMAIN_BYTES * 2) {
    throw new ValidationError(
      "InvalidDomain",
      "Domain too long; max 256 bytes."
    );
  }
  return hex;
}
