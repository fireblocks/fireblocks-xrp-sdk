import {
  OfferCreate,
  Amount,
  Memo,
  OfferCancel,
  Payment,
  PaymentFlags,
  Path,
  CredentialCreate,
  isValidAddress,
  CredentialAccept,
  CredentialDelete,
} from "xrpl";
import { IOfferCreateFlags, IPaymentFlags } from "../config/types";
import {
  deriveOfferCreateFlags,
  derivePaymentFlags,
  validateAmount,
  validateMemos,
  validateHash256,
} from "../utils/utils";
import { ValidationError } from "../errors/errors";
import { HEX_REGEX } from "../utils/constants";

/**
 * Service class for interacting with the XRPL Decentralized Exchange (DEX)
 */
export class DexService {
  /**
   * Builds an unsigned OfferCreate transaction for the XRPL DEX
   *
   * @param address - The XRPL address of the account making the offer (pre-validated)
   * @param sellAmount - The amount to sell (TakerGets)
   * @param buyAmount - The amount to buy (TakerPays)
   * @param fee - The transaction fee in drops (pre-validated)
   * @param sequence - The account sequence number (pre-validated)
   * @param lastLedgerSequence - The last ledger sequence where this transaction is valid
   * @param expiration - Optional expiration time in seconds since the Ripple Epoch
   * @param flags - Optional flags for the OfferCreate transaction
   * @param memos - Optional memos to attach to the transaction
   * @returns An unsigned OfferCreate transaction
   * @throws {ValidationError} If user-provided parameters are invalid
   */
  public getOfferCreateUnsignedTx = (
    address: string,
    sellAmount: Amount,
    buyAmount: Amount,
    fee: string,
    sequence: number,
    lastLedgerSequence: number,
    domainId?: string,
    expiration?: number,
    flags?: IOfferCreateFlags,
    memos?: Memo[]
  ): OfferCreate => {
    try {
      // Validate user-provided amounts
      validateAmount("sellAmount", sellAmount);
      validateAmount("buyAmount", buyAmount);

      // Validate domainId if provided
      if (domainId !== undefined) {
        validateHash256("domainId", domainId);
      }
      // Validate expiration if provided
      if (
        expiration !== undefined &&
        (!Number.isInteger(expiration) || expiration < 0)
      ) {
        throw new ValidationError(
          "InvalidExpiration",
          "Expiration must be a non-negative integer"
        );
      }

      // Validate memos if provided
      const validatedMemos = memos ? validateMemos(memos) : undefined;

      // Derive flags bitmask
      let combinedFlags: number | undefined;
      try {
        combinedFlags = flags ? deriveOfferCreateFlags(flags) : undefined;
      } catch (error: any) {
        throw new ValidationError(
          "InvalidFlags",
          `OfferCreate flags error: ${error.message}`
        );
      }

      // Build and return transaction
      const tx: OfferCreate = {
        TransactionType: "OfferCreate",
        Account: address,
        TakerGets: sellAmount,
        TakerPays: buyAmount,
        Fee: fee,
        Sequence: sequence,
        LastLedgerSequence: lastLedgerSequence,
        ...(validatedMemos && validatedMemos.length > 0
          ? { Memos: validatedMemos }
          : {}),
        ...(expiration !== undefined && { Expiration: expiration }),
        ...(combinedFlags !== undefined && { Flags: combinedFlags }),
        ...(domainId !== undefined && { DomainID: domainId }),
      };

      return tx;
    } catch (error: any) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        "OfferCreateError",
        `Error creating unsigned OfferCreate tx: ${error.message || error}`
      );
    }
  };

  /**
   * Builds an unsigned Payment transaction for cross-currency payments on the XRPL
   *
   * @param address - The XRPL address of the sender
   * @param destination - The XRPL address of the recipient
   * @param amount - The amount to deliver to the recipient
   * @param fee - The transaction fee in drops
   * @param sequence - The account sequence number
   * @param lastLedgerSequence - The last ledger sequence where this transaction is valid
   * @param sendMax - The maximum amount to send (for partial payments)
   * @param deliverMin - Optional minimum amount to deliver (requires tfPartialPayment when used)
   * @param paths - Optional payment paths to use
   * @param flags - Optional flags for the Payment transaction
   * @param memos - Optional memos to attach to the transaction
   * @param destinationTag - Optional destination tag for the recipient
   * @param invoiceId - Optional invoice ID
   * @returns An unsigned Payment transaction
   * @throws {ValidationError} If user-provided parameters are invalid
   */
  public getCrossCurrencyPaymentUnsignedTx = (
    address: string,
    destination: string,
    amount: Amount,
    fee: string,
    sequence: number,
    lastLedgerSequence: number,
    sendMax?: Amount,
    deliverMin?: Amount,
    paths?: Path[],
    flags?: IPaymentFlags,
    memos?: Memo[],
    destinationTag?: number,
    invoiceId?: string
  ): Payment => {
    try {
      const { tfPartialPayment } = PaymentFlags;

      // Validate destination address
      if (!destination || typeof destination !== "string") {
        throw new ValidationError(
          "InvalidDestination",
          "Destination address must be a string"
        );
      }

      // Validate user-provided amounts
      validateAmount("amount", amount);
      if (sendMax) {
        validateAmount("sendMax", sendMax);
      }
      if (deliverMin !== undefined) {
        validateAmount("deliverMin", deliverMin);
      }

      // Validate destinationTag if provided
      if (
        destinationTag !== undefined &&
        (!Number.isInteger(destinationTag) || destinationTag < 0)
      ) {
        throw new ValidationError(
          "InvalidDestinationTag",
          "DestinationTag must be a non-negative integer"
        );
      }

      // Validate invoiceId if provided
      if (
        invoiceId !== undefined &&
        (typeof invoiceId !== "string" || invoiceId.length === 0)
      ) {
        throw new ValidationError(
          "InvalidInvoiceId",
          "InvoiceId must be a non-empty string"
        );
      }

      // Validate memos if provided
      const validatedMemos = memos ? validateMemos(memos) : undefined;

      // Derive flags bitmask
      let combinedFlags: number | undefined;
      try {
        combinedFlags = flags ? derivePaymentFlags(flags) : undefined;
      } catch (error: any) {
        throw new ValidationError(
          "InvalidFlags",
          `Payment flags error: ${error.message}`
        );
      }

      // Ensure partial flag when using SendMax or DeliverMin
      const wantsPartial = Boolean((combinedFlags ?? 0) & tfPartialPayment);
      if (
        !wantsPartial &&
        (sendMax !== undefined || deliverMin !== undefined)
      ) {
        throw new ValidationError(
          "InvalidFlags",
          "SendMax or DeliverMin requires the tfPartialPayment flag."
        );
      }

      // Build and return transaction
      const tx: Payment = {
        TransactionType: "Payment",
        Account: address,
        Destination: destination,
        Amount: amount,
        Fee: fee,
        Sequence: sequence,
        LastLedgerSequence: lastLedgerSequence,
        ...(sendMax !== undefined && { SendMax: sendMax }),
        ...(deliverMin !== undefined && { DeliverMin: deliverMin }),
        ...(paths?.length ? { Paths: paths } : {}),
        ...(combinedFlags !== undefined && { Flags: combinedFlags }),
        ...(validatedMemos && validatedMemos.length > 0
          ? { Memos: validatedMemos }
          : {}),
        ...(destinationTag !== undefined && { DestinationTag: destinationTag }),
        ...(invoiceId !== undefined && { InvoiceID: invoiceId }),
      };

      return tx;
    } catch (error: any) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        "PaymentError",
        `Error creating unsigned Payment tx: ${error.message || error}`
      );
    }
  };

  /**
   * Builds an unsigned OfferCancel transaction for cancelling existing offers on the XRPL DEX
   *
   * @param address - The XRPL address of the account cancelling the offer
   * @param offerSequence - The sequence number of the offer to cancel
   * @param fee - The transaction fee in drops
   * @param sequence - The account sequence number
   * @param lastLedgerSequence - The last ledger sequence where this transaction is valid
   * @param memos - Optional memos to attach to the transaction
   * @returns An unsigned OfferCancel transaction
   * @throws {ValidationError} If user-provided parameters are invalid
   */
  public getOfferCancelUnsignedTx = (
    address: string,
    offerSequence: number,
    fee: string,
    sequence: number,
    lastLedgerSequence: number,
    memos?: Memo[]
  ): OfferCancel => {
    try {
      // Validate offerSequence
      if (!Number.isInteger(offerSequence) || offerSequence <= 0) {
        throw new ValidationError(
          "InvalidOfferSequence",
          "OfferSequence must be a positive integer"
        );
      }

      // Validate memos if provided
      const validatedMemos = memos ? validateMemos(memos) : undefined;

      // Build and return transaction
      const tx: OfferCancel = {
        TransactionType: "OfferCancel",
        Account: address,
        OfferSequence: offerSequence,
        Fee: fee,
        Sequence: sequence,
        LastLedgerSequence: lastLedgerSequence,
        ...(validatedMemos && validatedMemos.length > 0
          ? { Memos: validatedMemos }
          : {}),
      };

      return tx;
    } catch (error: any) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        "OfferCancelError",
        `Error creating unsigned OfferCancel tx: ${error.message || error}`
      );
    }
  };

  /**
   * Builds an unsigned CredentialCreate transaction for creating credentials on the XRPL
   * @param address - The XRPL address of the account creating the credential
   * @param fee - The transaction fee in drops
   * @param sequence - The account sequence number
   * @param lastLedgerSequence - The last ledger sequence where this transaction is valid
   * @param subject - The XRPL address of the subject (the entity receiving the credential)
   * @param credentialType - The type of credential being created (hex string)
   * @param expiration - Optional expiration time in seconds since the Ripple Epoch
   * @param uri - Optional URI associated with the credential (hex string)
   * @param flags - Optional flags for the CredentialCreate transaction (common transaction flags)
   * @param memos - Optional memos to attach to the transaction
   * @returns An unsigned CredentialCreate transaction
   * @throws {ValidationError} If user-provided parameters are invalid
   */
  public getCredentialCreateUnsignedTx = (
    address: string,
    fee: string,
    sequence: number,
    lastLedgerSequence: number,
    subject: string,
    credentialType: string,
    expiration?: number,
    uri?: string,
    flags?: number,
    memos?: Memo[]
  ): CredentialCreate => {
    try {
      // validate subject as a valid xrp address
      if (!subject || !isValidAddress(subject)) {
        throw new ValidationError(
          "InvalidSubject",
          "Subject must be a valid XRPL address"
        );
      }
      // CredentialType: hex string, 1–64 bytes (2–128 hex chars)
      if (
        typeof credentialType !== "string" ||
        !HEX_REGEX.test(credentialType) ||
        credentialType.length % 2 !== 0
      ) {
        throw new ValidationError(
          "InvalidCredentialType",
          "CredentialType must be a hex string (2-128 hex chars, even length, 1-64 bytes)"
        );
      }
      // Expiration: UInt32, positive integer
      if (expiration !== undefined) {
        if (!Number.isInteger(expiration) || expiration < 0) {
          throw new ValidationError(
            "InvalidExpiration",
            "Expiration must be a non-negative integer (seconds since Ripple Epoch)"
          );
        }
      }

      // URI: Hex string, 1–256 bytes (2–512 hex chars)
      if (uri !== undefined) {
        if (
          typeof uri !== "string" ||
          !HEX_REGEX.test(uri) ||
          uri.length % 2 !== 0
        ) {
          throw new ValidationError(
            "InvalidURI",
            "URI must be a hex string (2-512 hex chars, even length, 1-256 bytes)"
          );
        }
      }

      // Validate memos if provided
      const validatedMemos = memos ? validateMemos(memos) : undefined;

      // Build and return transaction
      const tx: CredentialCreate = {
        TransactionType: "CredentialCreate",
        Account: address,
        Subject: subject,
        CredentialType: credentialType,
        Fee: fee,
        Sequence: sequence,
        LastLedgerSequence: lastLedgerSequence,
        ...(expiration !== undefined && { Expiration: expiration }),
        ...(uri !== undefined && { URI: uri }),
        ...(flags !== undefined && { Flags: flags }),
        ...(validatedMemos &&
          validatedMemos.length > 0 && { Memos: validatedMemos }),
      };
      return tx;
    } catch (error: any) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        "OfferCancelError",
        `Error creating unsigned CredentialCreate tx: ${error.message || error}`
      );
    }
  };

  /**
   * Builds an unsigned CredentialAccept transaction for creating credentials on the XRPL
   * @param address - The XRPL address of the account creating the credential
   * @param fee - The transaction fee in drops
   * @param sequence - The account sequence number
   * @param lastLedgerSequence - The last ledger sequence where this transaction is valid
   * @param issuer - The XRPL address of the issuer (the entity that created the credential)
   * @param credentialType - The type of credential being created (hex string)
   * @param flags - Optional flags for the CredentialAccept transaction (common transaction flags)
   * @param memos - Optional memos to attach to the transaction
   * @returns An unsigned CredentialAccept transaction
   * @throws {ValidationError} If user-provided parameters are invalid
   */
  public getCredentialAcceptUnsignedTx = (
    address: string,
    fee: string,
    sequence: number,
    lastLedgerSequence: number,
    issuer: string,
    credentialType: string,
    flags?: number,
    memos?: Memo[]
  ): CredentialAccept => {
    try {
      // Validate Issuer
      if (!issuer || !isValidAddress(issuer)) {
        throw new ValidationError(
          "InvalidIssuer",
          "Issuer must be a valid XRPL address"
        );
      }
      // CredentialType: hex string, 1–64 bytes (2–128 hex chars, even length)
      if (
        typeof credentialType !== "string" ||
        !HEX_REGEX.test(credentialType) ||
        credentialType.length % 2 !== 0
      ) {
        throw new ValidationError(
          "InvalidCredentialType",
          "CredentialType must be a hex string (2-128 hex chars, even length, 1-64 bytes)"
        );
      }

      // Validate memos if provided
      const validatedMemos = memos ? validateMemos(memos) : undefined;

      // Construct the transaction
      const tx: CredentialAccept = {
        TransactionType: "CredentialAccept",
        Account: address,
        Issuer: issuer,
        CredentialType: credentialType,
        Fee: fee,
        Sequence: sequence,
        LastLedgerSequence: lastLedgerSequence,
        ...(flags !== undefined && { Flags: flags }),
        ...(validatedMemos &&
          validatedMemos.length > 0 && { Memos: validatedMemos }),
      };
      return tx;
    } catch (error: any) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        "CredentialAcceptError",
        `Error creating unsigned CredentialAccept tx: ${error.message || error}`
      );
    }
  };

  /**
   * Builds an unsigned CredentialDelete transaction for deleting credentials on the XRPL
   * @param address - The XRPL address of the account deleting the credential
   * @param fee - The transaction fee in drops
   * @param sequence - The account sequence number
   * @param lastLedgerSequence - The last ledger sequence where this transaction is valid
   * @param credentialType - The type of credential being deleted (hex string)
   * @param issuer - Optional XRPL address of the issuer (the entity that created the credential)
   * @param subject - Optional XRPL address of the subject (the entity receiving the credential)
   * @param flags - Optional flags for the CredentialDelete transaction (common transaction flags)
   * @param memos - Optional memos to attach to the transaction
   * @returns An unsigned CredentialDelete transaction
   * @throws {ValidationError} If user-provided parameters are invalid
   */
  public getCredentialDeleteUnsignedTx = (
    address: string,
    fee: string,
    sequence: number,
    lastLedgerSequence: number,
    credentialType: string,
    issuer?: string,
    subject?: string,
    flags?: number,
    memos?: Memo[]
  ): CredentialDelete => {
    try {
      // Must provide at least one: issuer or subject
      if ((!issuer || issuer === "") && (!subject || subject === "")) {
        throw new ValidationError(
          "MissingCredentialDeleteParams",
          "You must provide the Subject field, Issuer field, or both."
        );
      }

      // Validate that credentialType is provided (not null/undefined/empty)
      if (
        credentialType === undefined ||
        credentialType === null ||
        credentialType === ""
      ) {
        throw new ValidationError(
          "MissingCredentialType",
          "CredentialType is a required parameter for CredentialDelete"
        );
      }

      // Validate credentialType format: hex string, 1–64 bytes (2–128 hex chars), even length
      if (
        typeof credentialType !== "string" ||
        !HEX_REGEX.test(credentialType) ||
        credentialType.length % 2 !== 0
      ) {
        throw new ValidationError(
          "InvalidCredentialType",
          "CredentialType must be a hex string (2–128 hex chars, even length, 1–64 bytes)"
        );
      }

      // Validate issuer, if provided
      if (issuer && !isValidAddress(issuer)) {
        throw new ValidationError(
          "InvalidIssuer",
          "Issuer must be a valid XRPL address if provided"
        );
      }

      // Validate subject, if provided
      if (subject && !isValidAddress(subject)) {
        throw new ValidationError(
          "InvalidSubject",
          "Subject must be a valid XRPL address if provided"
        );
      }

      // Validate memos if provided
      const validatedMemos = memos ? validateMemos(memos) : undefined;

      // Build tx object
      const tx: CredentialDelete = {
        TransactionType: "CredentialDelete",
        Account: address,
        CredentialType: credentialType,
        ...(issuer && { Issuer: issuer }),
        ...(subject && { Subject: subject }),
        Fee: fee,
        Sequence: sequence,
        LastLedgerSequence: lastLedgerSequence,
        ...(flags !== undefined && { Flags: flags }),
        ...(validatedMemos &&
          validatedMemos.length > 0 && { Memos: validatedMemos }),
      };

      return tx;
    } catch (error: any) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError(
        "CredentialDeleteError",
        `Error creating unsigned CredentialDelete tx: ${error.message || error}`
      );
    }
  };
}
