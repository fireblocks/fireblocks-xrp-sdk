import {
  Wallet,
  Transaction,
  Client,
  TxResponse,
  isValidAddress,
  Amount,
} from "xrpl";
import {
  BasePath,
  Fireblocks,
  TransactionResponse,
  TransferPeerPathType,
} from "@fireblocks/ts-sdk";
import { SigningService, DexService, TokenService } from "./services";
import {
  TokenTransferOpts,
  CrossCurrencyPaymentOpts,
  OfferCreateOpts,
  OfferCancelOpts,
  NetworkParams,
  BurnTokenOpts,
  ClawbackOpts,
  FreezeTokenOpts,
  ITrustSetFlags,
  AccountSetOpts,
  TrustSetOpts,
  XrpTransferOpts,
  CredentialCreateOpts,
  CredentialAcceptOpts,
  CredentialDeleteOpts,
} from "./config/types";
import { XRPL_BURN_ADDRESS } from "./utils/constants";
import { getNetworkParams } from "./utils/utils";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { SigningError, ValidationError } from "./errors/errors";
import { Logger } from "./utils/logger";

const logger = new Logger("Fireblocks-Xrp-SDK");

dotenv.config();

export interface FireblocksConfig {
  apiKey: string;
  /**
   * The secret key to use for authentication.
   * This can also be set as an environment variable FIREBLOCKS_SECRET_KEY
   */
  apiSecret: string;
  vaultAccountId: string;
  assetId?: string;
  basePath?: BasePath;
}

export class FireblocksXrpSdk extends Wallet {
  private fireblocks: Fireblocks;
  private vaultAccountId: string;
  private assetId: string;
  private signingService: SigningService;
  private dexService: DexService;
  private tokenService: TokenService;
  client: Client;

  constructor(
    fireblocks: Fireblocks,
    config: FireblocksConfig,
    publicKey: string,
    address: string
  ) {
    super(publicKey, "DUMMY_PRIVATE_KEY_NOT_USED", {
      masterAddress: address,
    });

    this.fireblocks = fireblocks;
    this.vaultAccountId = config.vaultAccountId;
    this.assetId = config.assetId || "XRP_TEST";

    const rpcUrl =
      this.assetId === "XRP_TEST"
        ? "wss://s.altnet.rippletest.net:51233"
        : "wss://xrplcluster.com";

    this.client = new Client(rpcUrl);
    this.signingService = new SigningService(this.fireblocks, this);
    this.dexService = new DexService();
    this.tokenService = new TokenService();
  }

  // Override the sign method from the parent Wallet class
  public sign = (
    transaction: Transaction,
    publicKey: string,
    multisign?: boolean | string
  ): { tx_blob: string; hash: string } => {
    return this.signingService.sign(transaction, publicKey, multisign);
  };

  /**
   * OfferCreate transaction on the Ripple ledger, signed by the Fireblocks SDK and returns the SubmitResponse object from the xrpl SDK
   * @param sellAmount - TakerGets param
   * @param buyAmount - TakerPays param
   * @param flags - optional, OfferCreate flags
   * @param expiration - optional, Expiration timestamp in seconds
   * @param domainId - optional, Domain ID for the offer
   * @param memos - optional, memos object for an xrp transaction
   * @returns SubmitResponse object with tx results
   */

  public offerCreate = async ({
    sellAmount,
    buyAmount,
    flags,
    domainId,
    expiration,
    memos,
  }: OfferCreateOpts): Promise<TxResponse> => {
    try {
      const { fee, sequence, lastLedgerSequence } =
        await this.getClientParams();

      logger.info(
        `Creating an OfferCreate transaction for wallet: ${this.address}...`
      );
      const transaction = this.dexService.getOfferCreateUnsignedTx(
        this.address,
        sellAmount,
        buyAmount,
        fee,
        sequence,
        lastLedgerSequence,
        domainId,
        expiration,
        flags,
        memos
      );
      const note = `OfferCreate transaction for wallet: ${this.address}`;
      return await this.signAndSubmitTx(transaction, note);
    } catch (error: any) {
      if (error instanceof ValidationError || error instanceof SigningError) {
        throw error;
      }
      throw new Error(`Error in offerCreate: ${error.message || error}`);
    }
  };

  /**
   * OfferCancel transaction on the Ripple ledger, signed by the Fireblocks SDK and returns the TxResponse object from the xrpl SDK
   * @param offerSequence - OfferSequence param
   * @param memos - optional, memos object for an xrp transaction
   * @returns TxResponse object with tx results from Ripple ledger
   * @throws Error if the transaction fails
   */
  public offerCancel = async ({
    offerSequence,
    memos,
  }: OfferCancelOpts): Promise<TxResponse> => {
    try {
      const { fee, sequence, lastLedgerSequence } =
        await this.getClientParams();

      logger.info(`Creating an OfferCancel transaction...`);
      const transaction = this.dexService.getOfferCancelUnsignedTx(
        this.address,
        offerSequence,
        fee,
        sequence,
        lastLedgerSequence,
        memos
      );
      const note = `OfferCancel transaction for wallet: ${this.address}`;
      return await this.signAndSubmitTx(transaction, note);
    } catch (error: any) {
      if (error instanceof ValidationError || error instanceof SigningError) {
        throw error;
      }
      throw new Error(`Error in offerCreate: ${error.message || error}`);
    }
  };

  /**
   * CrossCurrencyPayment transaction on the Ripple ledger, signed by the Fireblocks SDK and returns the TxResponse object from the xrpl SDK
   * @param destination - destination address
   * @param amount - Amount to send
   * @param sendMax - Amount to send max
   * @param deliverMin - optional, minimum amount to deliver (requires tfPartialPayment when used with sendMax)
   * @param flags - optional, flags for the transaction (common transaction flags)
   * @param invoiceId - optional, invoice ID for the transaction
   * @param destinationTag - optional, destination tag for the transaction
   * @param paths - optional, array of paths for the cross currency payment
   * @param memos - optional, memos object for an xrp transaction
   * @returns TxResponse object with tx results from Ripple ledger
   * @throws Error if the transaction fails
   */
  public crossCurrencyPayment = async ({
    destination,
    amount,
    sendMax,
    deliverMin,
    flags,
    invoiceId,
    destinationTag,
    paths,
    memos,
  }: CrossCurrencyPaymentOpts): Promise<TxResponse> => {
    try {
      const { fee, sequence, lastLedgerSequence } =
        await this.getClientParams();

      logger.info(`Creating a CrossCurrencyPayment transaction...`);
      const transaction = this.dexService.getCrossCurrencyPaymentUnsignedTx(
        this.address,
        destination,
        amount,
        fee,
        sequence,
        lastLedgerSequence,
        sendMax,
        deliverMin,
        paths,
        flags,
        memos,
        destinationTag,
        invoiceId
      );
      const note = `CrossCurrencyPayment transaction for wallet: ${this.address}`;
      return await this.signAndSubmitTx(transaction, note);
    } catch (error: any) {
      if (error instanceof ValidationError || error instanceof SigningError) {
        throw error;
      }
      throw new Error(`Error in crossCurrencyPayment: ${error.message}`);
    }
  };

  /**
   * CredentialCreate transaction on the Ripple ledger, signed by the Fireblocks SDK and returns the TxResponse object from the xrpl SDK
   * @param subject - the subject of the credential
   * @param credentialType - the type of the credential
   * @param expiration - optional, expiration timestamp in seconds
   * @param uri - optional, URI for the credential
   * @param flags - optional, flags for the credential (common transaction flags)
   * @param memos - optional, memos object for an xrp transaction
   * @returns TxResponse object with tx results from Ripple ledger
   * @throws Error if the transaction fails
   */
  public credentialCreate = async ({
    subject,
    credentialType,
    expiration,
    uri,
    flags,
    memos,
  }: CredentialCreateOpts) => {
    try {
      const { fee, sequence, lastLedgerSequence } =
        await this.getClientParams();

      logger.info(`Creating a CredentialCreate transaction...`);
      const transaction = this.dexService.getCredentialCreateUnsignedTx(
        this.address,
        fee,
        sequence,
        lastLedgerSequence,
        subject,
        credentialType,
        expiration,
        uri,
        flags,
        memos
      );
      const note = `CredentialCreate transaction for wallet: ${this.address}`;
      return await this.signAndSubmitTx(transaction, note);
    } catch (error: any) {
      if (error instanceof ValidationError || error instanceof SigningError) {
        throw error;
      }
      throw new Error(`Error in credentialCreate: ${error.message}`);
    }
  };

  /**
   * CredentialAccept transaction on the Ripple ledger, signed by the Fireblocks SDK and returns the TxResponse object from the xrpl SDK
   * @param issuer - the issuer of the credential
   * @param credentialType - the type of the credential
   * @param flags - optional, flags for the credential (common transaction flags)
   * @param memos - optional, memos object for an xrp transaction
   * @returns TxResponse object with tx results from Ripple ledger
   * @throws Error if the transaction fails
   */
  public credentialAccept = async ({
    issuer,
    credentialType,
    flags,
    memos,
  }: CredentialAcceptOpts): Promise<TxResponse> => {
    try {
      const { fee, sequence, lastLedgerSequence } =
        await this.getClientParams();

      logger.info(`Creating a CredentialAccept transaction...`);
      const transaction = this.dexService.getCredentialAcceptUnsignedTx(
        this.address,
        fee,
        sequence,
        lastLedgerSequence,
        issuer,
        credentialType,
        flags,
        memos
      );
      const note = `CredentialAccept transaction for wallet: ${this.address}`;
      return await this.signAndSubmitTx(transaction, note);
    } catch (error: any) {
      if (error instanceof ValidationError || error instanceof SigningError) {
        throw error;
      }
      throw new Error(`Error in credentialAccept: ${error.message}`);
    }
  };

  public credentialDelete = async ({
    credentialType,
    issuer,
    subject,
    flags,
    memos,
  }: CredentialDeleteOpts): Promise<TxResponse> => {
    try {
      const { fee, sequence, lastLedgerSequence } =
        await this.getClientParams();

      logger.info(`Creating a CredentialDelete transaction...`);
      const transaction = this.dexService.getCredentialDeleteUnsignedTx(
        this.address,
        fee,
        sequence,
        lastLedgerSequence,
        credentialType,
        issuer,
        subject,
        flags,
        memos
      );
      const note = `CredentialDelete transaction for wallet: ${this.address}`;
      return await this.signAndSubmitTx(transaction, note);
    } catch (error: any) {
      if (error instanceof ValidationError || error instanceof SigningError) {
        throw error;
      }
      throw new Error(`Error in credentialDelete: ${error.message}`);
    }
  };
  /**
   * AccountSet transaction on the Ripple ledger, signed by the Fireblocks SDK and returns the TxResponse object from the xrpl SDK
   * @param configs - AccountSet configurations, can include setFlag, clearFlag, tfFlags, domain, transferRate, tickSize, emailHash, messageKey
   * @param memos - optional, memos object for an xrp transaction
   * @returns TxResponse object with tx results from Ripple ledger
   * @throws Error if the transaction fails
   * @throws ValidationError if the configs are invalid
   * @throws SigningError if the transaction signing fails
   */
  public accountSet = async ({
    configs,
    memos,
  }: AccountSetOpts): Promise<TxResponse> => {
    try {
      const { fee, sequence, lastLedgerSequence } =
        await this.getClientParams();

      logger.info(
        `Creating an AccountSet transaction for wallet: ${this.address}...`
      );
      const tx = this.tokenService.createAccountSetTx(
        this.address,
        fee,
        sequence,
        lastLedgerSequence,
        configs,
        memos
      );

      const note = `AccountSet transaction for wallet: ${this.address}`;
      return await this.signAndSubmitTx(tx, note);
    } catch (err: any) {
      if (err instanceof ValidationError || err instanceof SigningError) {
        throw err;
      }
      throw new Error(`Error in accountSet: ${err.message || err}`);
    }
  };

  /**
   * Create or modify a trust line between this SDK’s account (this.address)
   * and a counterparty (specified inside limitAmount.issuer).
   * @param limitAmount - the IssuedCurrencyAmount defining the counterparty and currency
   * @param flags - optional ITrustSetFlags (e.g. tfSetNoRipple, tfSetFreeze, tfSetfAuth, etc.)
   * @param qualityIn - optional integer >0 (1..2^32-1)
   * @param qualityOut - optional integer >0 (1..2^32-1)
   * @param memos - optional memos to attach
   * @param destinationTag - optional destination tag (0..2^32-1)
   * @param invoiceId - optional 32-byte (64-hex) invoice ID
   * @returns TxResponse object with tx results from Ripple ledger
   * @throws Error if the transaction fails
   * @throws ValidationError if the configs are invalid
   * @throws SigningError if the transaction signing fails
   *
   */
  public trustSet = async ({
    limitAmount,
    flags,
    qualityIn,
    qualityOut,
    memos,
  }: TrustSetOpts): Promise<TxResponse> => {
    try {
      // Fetch network parameters (fee, sequence, lastLedgerSequence)
      const { fee, sequence, lastLedgerSequence } =
        await this.getClientParams();

      logger.info(
        `Creating a TrustSet transaction for wallet: ${this.address} → trust line to ${limitAmount.issuer} (${limitAmount.currency})...`
      );

      // Delegate to service‐level createTrustSetTx (may throw ValidationError)
      const tx = this.tokenService.createTrustSetTx(
        this.address,
        fee,
        sequence,
        limitAmount,
        lastLedgerSequence,
        flags,
        qualityIn,
        qualityOut,
        memos
      );

      // Sign & submit
      const note = `TrustSet: trust line to ${limitAmount.issuer} (${limitAmount.currency})`;
      return await this.signAndSubmitTx(tx, note);
    } catch (err: any) {
      // Rethrow ValidationError or SigningError unmodified
      if (err instanceof ValidationError || err instanceof SigningError) {
        throw err;
      }
      // Wrap any other unexpected errors
      throw new Error(`Error in trustSet: ${err.message || err}`);
    } finally {
      // Always disconnect
      await this.shutDown();
    }
  };

  /**
   * A helper method to transfer XRP using the SDK. Note: This method uses Fireblocks createTransaction endpoint and does not require RAW signing!
   * @param destination - destination address
   * @param amount - amount to transfer, in XRP
   * @param note - optional transaction note
   * @returns - Fireblocks TransactionResponse object
   */
  public xrpTransfer = async ({
    destination,
    amount,
    note,
  }: XrpTransferOpts): Promise<TransactionResponse> => {
    try {
      //address validation for OneTimeAdress
      if (JSON.stringify(destination).includes("oneTimeAddress")) {
        if (!isValidAddress(destination?.oneTimeAddress?.address!)) {
          throw new ValidationError(
            "InvalidDestination",
            `Invalid destination one time address`
          );
        }
      }
      logger.info(`Creating an XRP transfer transaction...`);
      let tx;
      try {
        tx = (
          await this.fireblocks.transactions.createTransaction({
            transactionRequest: {
              assetId: this.assetId,
              source: {
                type: TransferPeerPathType.VaultAccount,
                id: this.vaultAccountId,
              },
              destination,
              amount,
              note: note ? note : "XRP transfer using the Fireblocks XRP SDK",
            },
          })
        ).data;
      } catch (error: any) {
        throw new Error(
          `Fireblocks createTransaction error: ${JSON.stringify(
            error.response,
            null,
            2
          )}`
        );
      }

      if (!tx) {
        throw new Error(`Error creating xrp transfer on Fireblocks`);
      }
      const res = await this.signingService.waitForSignature(tx);
      if (!res) {
        throw new Error(`Failed to complete the Tx submission on Fireblocks`);
      }
      return res;
    } catch (error: any) {
      if (error instanceof ValidationError || error instanceof SigningError) {
        throw error;
      }
      throw new Error(`Error in xrpTransfer: ${error}`);
    }
  };

  /**
   * A Paymet transaction on Ripple, used for fungible or IOU token payments
   * @param destination - destination address
   * @param amount - Amount to send
   *
   * @returns TxResponse object with tx results from Ripple ledger
   */
  public tokenTransfer = async ({
    destination,
    amount,
    flags,
    memos,
    destinationTag,
    invoiceId,
    sendMax,
    deliverMin,
  }: TokenTransferOpts): Promise<TxResponse> => {
    try {
      const { fee, sequence, lastLedgerSequence } =
        await this.getClientParams();

      logger.info(`Creating a token transfer transaction...`);
      const unsignedTx = this.tokenService.createFungibleTokenPaymentTx(
        this.address,
        destination,
        amount,
        fee,
        sequence,
        lastLedgerSequence,
        flags,
        memos,
        destinationTag,
        invoiceId,
        sendMax,
        deliverMin
      );
      const note = `Token transfer transaction for wallet ${this.address}`;
      return await this.signAndSubmitTx(unsignedTx, note);
    } catch (error: any) {
      if (error instanceof ValidationError || error instanceof SigningError) {
        throw error;
      }
      throw new Error(`Error in tokenTransfer: ${error.message}`);
    } finally {
      await this.shutDown();
    }
  };

  public burnToken = async ({
    amount,
    flags,
    memos,
    destinationTag,
    invoiceId,
  }: BurnTokenOpts): Promise<TxResponse> => {
    try {
      const { fee, sequence, lastLedgerSequence } =
        await this.getClientParams();

      logger.info(`Creating a token burn transaction...`);
      const tx = this.tokenService.createFungibleTokenPaymentTx(
        this.address,
        XRPL_BURN_ADDRESS,
        amount,
        fee,
        sequence,
        lastLedgerSequence,
        flags,
        memos,
        destinationTag,
        invoiceId
      );
      const note = `Token burn transaction for wallet ${this.address}`;
      return await this.signAndSubmitTx(tx, note);
    } catch (error: any) {
      if (error instanceof ValidationError || error instanceof SigningError) {
        throw error;
      }
      throw new Error(`Error in burnToken: ${error.message || error}`);
    } finally {
      await this.shutDown();
    }
  };
  /**
   * Freeze or unfreeze a trust line between issuer and holder.
   */
  public freezeToken = async ({
    holder,
    currency,
    freeze,
    memos,
  }: FreezeTokenOpts): Promise<TxResponse> => {
    try {
      const { fee, sequence, lastLedgerSequence } =
        await this.getClientParams();

      logger.info(
        `Creating a ${
          freeze ? "freeze" : "unfreeze"
        } trust line for ${holder}...`
      );

      // Build the unsigned TrustSet tx
      const limitAmount: Amount = {
        currency,
        issuer: holder,
        value: "1", // for freeze/unfreeze, the actual numeric value is ignored
      };

      // Build a small flags‐object for freeze/unfreeze
      const flags: ITrustSetFlags = freeze
        ? { tfSetFreeze: true }
        : { tfClearFreeze: true };

      const tx = this.tokenService.createTrustSetTx(
        this.address,
        fee,
        sequence,
        limitAmount,
        lastLedgerSequence,
        flags,
        undefined,
        undefined,
        memos
      );

      // Sign & submit
      const action = freeze ? "freeze" : "unfreeze";
      const note = `${action} trust line for ${currency}/${this.address} → ${holder}`;
      return await this.signAndSubmitTx(tx, note);
    } catch (err: any) {
      if (err instanceof ValidationError || err instanceof SigningError) {
        throw err;
      }
      throw new Error(`Error in freezeToken: ${err.message || err}`);
    } finally {
      await this.shutDown();
    }
  };

  /**
   * Clawback issued tokens from a holder’s balance.
   *
   */
  public clawback = async ({
    holder,
    currency,
    value,
    memos,
  }: ClawbackOpts): Promise<TxResponse> => {
    try {
      //Fetch network params (fee, sequence, lastLedgerSequence) and connect the client
      const { fee, sequence, lastLedgerSequence } =
        await this.getClientParams();

      logger.info(
        `Creating a Clawback transaction from ${holder} for wallet: ${this.classicAddress}...`
      );

      // Build the amount object, validation of the data is handled by the service method
      const amount: Amount = {
        issuer: holder,
        currency,
        value,
      };

      // Build the unsigned Clawback TX

      const tx = this.tokenService.createClawbackTx(
        this.address,
        amount,
        fee,
        sequence,
        lastLedgerSequence,
        memos
      );

      // Sign & submit
      const note = `Clawback ${JSON.stringify(amount)} from ${holder}`;
      return await this.signAndSubmitTx(tx, note);
    } catch (error: any) {
      if (error instanceof ValidationError || error instanceof SigningError) {
        throw error;
      }
      throw new Error(`Error in clawBack: ${error.message || error}`);
    } finally {
      await this.shutDown();
    }
  };

  // ---------- PRIVATE HELPER METHODS ----------
  private getClientParams = async (): Promise<NetworkParams> => {
    logger.info(`Connecting to the XRP Ledger...`);
    await this.client.connect();

    if (!this.client.isConnected()) {
      throw new Error("Failed to connect to the XRP Ledger");
    }

    const { fee, sequence, lastLedgerSequence } = await getNetworkParams(
      this.client,
      this.address
    );
    return { fee, sequence, lastLedgerSequence };
  };

  public shutDown = async () => {
    if (this.client.isConnected()) {
      logger.info("Disconnecting from the XRP Ledger...");
      await this.client.disconnect();
    }
  };

  public static createFireblocksInstance = (
    config: Omit<FireblocksConfig, "vaultAccountId"> & {
      vaultAccountId?: string;
    }
  ): Fireblocks => {
    const secretKey = config.apiSecret || process.env.FIREBLOCKS_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        "apiSecret is required either in the configuration or as environment variable FIREBLOCKS_SECRET_KEY"
      );
    }

    return new Fireblocks({
      apiKey: config.apiKey,
      secretKey,
      basePath: config.basePath || BasePath.US,
      additionalOptions: {
        userAgent: "FireblocksRippleSDK/1.1.0",
      },
    });
  };

  public static fetchXrpAccountInfo = async (
    fireblocks: Fireblocks,
    config: FireblocksConfig
  ): Promise<{ address: string; publicKey: string }> => {
    const assetId = config.assetId || "XRP_TEST";

    const vaultAccount =
      await fireblocks.vaults.getVaultAccountAssetAddressesPaginated({
        vaultAccountId: config.vaultAccountId,
        assetId,
      });

    const xrpAssetAddress = vaultAccount?.data?.addresses?.[0]?.address;
    if (!xrpAssetAddress) {
      throw new Error(
        `XRP address not found for vault account ${config.vaultAccountId}`
      );
    }

    const publicKeyInfo = await fireblocks.vaults.getPublicKeyInfoForAddress({
      vaultAccountId: config.vaultAccountId,
      assetId,
      change: 0,
      addressIndex: 0,
      compressed: true,
    });
    if (!publicKeyInfo?.data?.publicKey) {
      throw new ValidationError(
        "PublicKeyNotReturned",
        `Public key not found for vault account ${config.vaultAccountId} and asset ${assetId}`
      );
    }
    const publicKey = publicKeyInfo.data.publicKey.toUpperCase();
    return { address: xrpAssetAddress, publicKey };
  };

  private signAndSubmitTx = async (
    transaction: any,
    note?: string
  ): Promise<TxResponse> => {
    try {
      if (!this.client.isConnected()) {
        await this.client.connect();
      }

      try {
        await this.client.autofill(transaction);
      } catch (error: any) {
        throw new SigningError(
          "AutofillFailed",
          `Failed to autofill transaction: ${error.message || error}`
        );
      }

      logger.info(`Signing the transaction...`);
      let tx_blob: string;
      try {
        ({ tx_blob } = await this.signingService.signAsync(
          transaction,
          this.publicKey,
          this.assetId,
          this.vaultAccountId,
          note
        ));
      } catch (error: any) {
        throw new SigningError(
          "SignFailed",
          `Failed to sign transaction: ${error.message || error}`
        );
      }

      logger.info(`Submitting the transaction...`);
      let submitResult: TxResponse;
      try {
        submitResult = await this.client.submitAndWait(tx_blob);
      } catch (error: any) {
        throw new SigningError(
          "SubmitFailed",
          `Failed to submit transaction: ${error.message || error}`
        );
      }

      if (submitResult.result.validated === false) {
        throw new SigningError(
          "NotValidated",
          `Transaction was submitted but not validated: ${JSON.stringify(
            submitResult.result
          )}`
        );
      }
      logger.info(
        `Transaction submitted and validated by the chain. Returning tx data...\n`
      );

      return submitResult;
    } catch (error: any) {
      if (error instanceof SigningError) {
        throw error;
      }
      throw new SigningError(
        "UnknownError",
        `Unexpected error in signing flow: ${error.message || error}`
      );
    }
  };
}
