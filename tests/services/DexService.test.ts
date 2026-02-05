import { DexService } from "../../src/services";
import { ValidationError } from "../../src/errors/errors";
import {
  deriveOfferCreateFlags,
  derivePaymentFlags,
  validateAmount,
  validateMemos,
  validateHash256,
} from "../../src/utils/utils";
import { Amount, Memo, Path } from "xrpl";
import { IPaymentFlags, IOfferCreateFlags } from "../../src/config/types";

jest.mock("../../src/utils/utils", () => ({
  ...jest.requireActual("../../src/utils/utils"),
  deriveOfferCreateFlags: jest.fn(),
  derivePaymentFlags: jest.fn(),
  validateAmount: jest.fn(),
  validateMemos: jest.fn((memos) => memos),
  validateHash256: jest.fn(),
}));

const mockDeriveOfferCreateFlags = deriveOfferCreateFlags as jest.Mock;
const mockDerivePaymentFlags = derivePaymentFlags as jest.Mock;
const mockValidateAmount = validateAmount as jest.Mock;
const mockValidateMemos = validateMemos as jest.Mock;
const mockValidateHash256 = validateHash256 as jest.Mock;

jest.mock("xrpl", () => ({
  ...jest.requireActual("xrpl"),
  isValidAddress: jest.fn(
    (address) => typeof address === "string" && address.startsWith("r")
  ),
}));

const isValidAddress = require("xrpl").isValidAddress as jest.Mock;

describe("DexService", () => {
  let service: DexService;

  beforeEach(() => {
    service = new DexService();
    jest.clearAllMocks();
  });

  // ========== OfferCreate ==========

  describe("getOfferCreateUnsignedTx", () => {
    const baseArgs = {
      address: "rMaker",
      sellAmount: {
        currency: "USD",
        issuer: "rIssuer",
        value: "100",
      } as Amount,
      buyAmount: { currency: "BTC", issuer: "rIssuer", value: "0.5" } as Amount,
      fee: "12",
      sequence: 100,
      lastLedgerSequence: 120,
      domainId:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      expiration: 500,
      flags: { tfFillOrKillOffer: true } as IOfferCreateFlags,
      memos: [{ Memo: { MemoType: "foo", MemoData: "bar" } }] as Memo[],
    };

    it("constructs OfferCreate tx with all valid inputs including domainId", () => {
      mockValidateAmount.mockReturnValue(undefined);
      mockDeriveOfferCreateFlags.mockReturnValue(0x80000000);
      mockValidateMemos.mockReturnValue(baseArgs.memos);
      mockValidateHash256.mockReturnValue(undefined);

      const tx = service.getOfferCreateUnsignedTx(
        baseArgs.address,
        baseArgs.sellAmount,
        baseArgs.buyAmount,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence,
        baseArgs.domainId,
        baseArgs.expiration,
        baseArgs.flags,
        baseArgs.memos
      );
      expect(tx.TransactionType).toBe("OfferCreate");
      expect(tx.Expiration).toBe(baseArgs.expiration);
      expect(tx.Flags).toBe(0x80000000);
      expect(tx.Memos).toEqual(baseArgs.memos);
      expect(tx.DomainID).toBe(baseArgs.domainId);
      expect(mockValidateHash256).toHaveBeenCalledWith(
        "domainId",
        baseArgs.domainId
      );
    });

    it("omits optional fields when not provided", () => {
      mockValidateAmount.mockReturnValue(undefined);
      mockDeriveOfferCreateFlags.mockReturnValue(undefined);

      const tx = service.getOfferCreateUnsignedTx(
        baseArgs.address,
        baseArgs.sellAmount,
        baseArgs.buyAmount,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence
      );
      expect(tx.Expiration).toBeUndefined();
      expect(tx.Flags).toBeUndefined();
      expect(tx.Memos).toBeUndefined();
      expect(tx.DomainID).toBeUndefined();
      expect(mockValidateHash256).not.toHaveBeenCalled();
    });

    it("throws ValidationError for invalid domainId", () => {
      mockValidateAmount.mockReturnValue(undefined);
      mockDeriveOfferCreateFlags.mockReturnValue(undefined);
      mockValidateHash256.mockImplementation(() => {
        throw new ValidationError("InvalidHash256", "domainId bad");
      });
      expect(() =>
        service.getOfferCreateUnsignedTx(
          baseArgs.address,
          baseArgs.sellAmount,
          baseArgs.buyAmount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          "bad"
        )
      ).toThrow(ValidationError);
    });

    it("throws ValidationError for invalid expiration", () => {
      mockValidateAmount.mockReturnValue(undefined);
      expect(() =>
        service.getOfferCreateUnsignedTx(
          baseArgs.address,
          baseArgs.sellAmount,
          baseArgs.buyAmount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          undefined,
          -1
        )
      ).toThrow(ValidationError);
      expect(() =>
        service.getOfferCreateUnsignedTx(
          baseArgs.address,
          baseArgs.sellAmount,
          baseArgs.buyAmount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          undefined,
          1.5
        )
      ).toThrow(ValidationError);
    });

    it("throws ValidationError when deriveOfferCreateFlags throws", () => {
      mockValidateAmount.mockReturnValue(undefined);
      mockDeriveOfferCreateFlags.mockImplementation(() => {
        throw new Error("flags fail");
      });
      expect(() =>
        service.getOfferCreateUnsignedTx(
          baseArgs.address,
          baseArgs.sellAmount,
          baseArgs.buyAmount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          undefined,
          undefined,
          baseArgs.flags
        )
      ).toThrow(ValidationError);
    });

    it("wraps unexpected errors as OfferCreateError", () => {
      mockValidateAmount.mockImplementationOnce(() => {
        throw new Error("oops");
      });
      expect(() =>
        service.getOfferCreateUnsignedTx(
          baseArgs.address,
          baseArgs.sellAmount,
          baseArgs.buyAmount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence
        )
      ).toThrow(expect.objectContaining({ code: "OfferCreateError" }));
    });
  });

  // ========== CrossCurrencyPayment ==========

  describe("getCrossCurrencyPaymentUnsignedTx", () => {
    const baseArgs = {
      address: "rSender",
      destination: "rDest",
      amount: { currency: "USD", issuer: "rIssuer", value: "100" } as Amount,
      fee: "12",
      sequence: 1,
      lastLedgerSequence: 10,
      sendMax: { currency: "USD", issuer: "rIssuer", value: "150" } as Amount,
      deliverMin: { currency: "EUR", issuer: "rIssuer2", value: "90" } as Amount,
      paths: [
        [{ account: "rSomeAccount", currency: "USD", issuer: "rIssuer" }],
      ] as Path[],
      flags: { tfPartialPayment: true } as IPaymentFlags,
      memos: [{ Memo: { MemoType: "note", MemoData: "test" } }] as Memo[],
      destinationTag: 123,
      invoiceId: "INV123",
    };

    it("constructs Payment tx with valid inputs", () => {
      mockValidateAmount.mockReturnValue(undefined);
      mockDerivePaymentFlags.mockReturnValue(0x00020000);
      mockValidateMemos.mockReturnValue(baseArgs.memos);

      const tx = service.getCrossCurrencyPaymentUnsignedTx(
        baseArgs.address,
        baseArgs.destination,
        baseArgs.amount,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence,
        baseArgs.sendMax,
        baseArgs.deliverMin,
        baseArgs.paths,
        baseArgs.flags,
        baseArgs.memos,
        baseArgs.destinationTag,
        baseArgs.invoiceId
      );
      expect(tx.TransactionType).toBe("Payment");
      expect(tx.SendMax).toEqual(baseArgs.sendMax);
      expect(tx.DeliverMin).toEqual(baseArgs.deliverMin);
      expect(tx.Paths).toEqual(baseArgs.paths);
      expect(tx.Flags).toBe(0x00020000);
      expect(tx.Memos).toEqual(baseArgs.memos);
      expect(tx.DestinationTag).toBe(baseArgs.destinationTag);
      expect(tx.InvoiceID).toBe(baseArgs.invoiceId);
    });

    it("includes DeliverMin when deliverMin is provided", () => {
      mockValidateAmount.mockReturnValue(undefined);
      mockDerivePaymentFlags.mockReturnValue(0x00020000);

      const tx = service.getCrossCurrencyPaymentUnsignedTx(
        baseArgs.address,
        baseArgs.destination,
        baseArgs.amount,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence,
        baseArgs.sendMax,
        baseArgs.deliverMin,
        baseArgs.paths,
        baseArgs.flags,
        baseArgs.memos,
        baseArgs.destinationTag,
        baseArgs.invoiceId
      );
      expect(tx.DeliverMin).toEqual(baseArgs.deliverMin);
    });

    it("throws ValidationError when sendMax or deliverMin used without tfPartialPayment", () => {
      mockValidateAmount.mockReturnValue(undefined);
      mockDerivePaymentFlags.mockReturnValue(0); // no tfPartialPayment

      expect(() =>
        service.getCrossCurrencyPaymentUnsignedTx(
          baseArgs.address,
          baseArgs.destination,
          baseArgs.amount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.sendMax,
          undefined,
          baseArgs.paths
        )
      ).toThrow(new ValidationError("InvalidFlags", "SendMax or DeliverMin requires the tfPartialPayment flag."));

      expect(() =>
        service.getCrossCurrencyPaymentUnsignedTx(
          baseArgs.address,
          baseArgs.destination,
          baseArgs.amount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          undefined,
          { currency: "EUR", issuer: "rI", value: "50" } as Amount,
          baseArgs.paths
        )
      ).toThrow(new ValidationError("InvalidFlags", "SendMax or DeliverMin requires the tfPartialPayment flag."));
    });

    it("omits optional fields when not provided", () => {
      mockValidateAmount.mockReturnValue(undefined);
      mockDerivePaymentFlags.mockReturnValue(undefined);

      const tx = service.getCrossCurrencyPaymentUnsignedTx(
        baseArgs.address,
        baseArgs.destination,
        baseArgs.amount,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence
      );
      expect(tx.SendMax).toBeUndefined();
      expect(tx.DeliverMin).toBeUndefined();
      expect(tx.Paths).toBeUndefined();
      expect(tx.Flags).toBeUndefined();
      expect(tx.Memos).toBeUndefined();
      expect(tx.DestinationTag).toBeUndefined();
      expect(tx.InvoiceID).toBeUndefined();
    });

    it("throws ValidationError for invalid destination", () => {
      expect(() =>
        service.getCrossCurrencyPaymentUnsignedTx(
          baseArgs.address,
          "" as any,
          baseArgs.amount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence
        )
      ).toThrow(ValidationError);
    });

    it("throws ValidationError for invalid amount or sendMax", () => {
      mockValidateAmount.mockImplementationOnce(() => {
        throw new ValidationError("BadAmt", "amount invalid");
      });
      expect(() =>
        service.getCrossCurrencyPaymentUnsignedTx(
          baseArgs.address,
          baseArgs.destination,
          baseArgs.amount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence
        )
      ).toThrow(ValidationError);

      mockValidateAmount.mockReturnValue(undefined);
      mockValidateAmount.mockImplementationOnce(() => {
        throw new ValidationError("BadAmt", "sendMax invalid");
      });
      expect(() =>
        service.getCrossCurrencyPaymentUnsignedTx(
          baseArgs.address,
          baseArgs.destination,
          baseArgs.amount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.sendMax,
          undefined // deliverMin
        )
      ).toThrow(ValidationError);
    });

    it("throws ValidationError for invalid destinationTag or invoiceId", () => {
      expect(() =>
        service.getCrossCurrencyPaymentUnsignedTx(
          baseArgs.address,
          baseArgs.destination,
          baseArgs.amount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          -5
        )
      ).toThrow(ValidationError);

      expect(() =>
        service.getCrossCurrencyPaymentUnsignedTx(
          baseArgs.address,
          baseArgs.destination,
          baseArgs.amount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ""
        )
      ).toThrow(ValidationError);
    });

    it("throws ValidationError when derivePaymentFlags errors", () => {
      mockValidateAmount.mockReturnValue(undefined);
      mockDerivePaymentFlags.mockImplementation(() => {
        throw new Error("flag error");
      });
      expect(() =>
        service.getCrossCurrencyPaymentUnsignedTx(
          baseArgs.address,
          baseArgs.destination,
          baseArgs.amount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          undefined,
          undefined,
          undefined,
          baseArgs.flags
        )
      ).toThrow(ValidationError);
    });

    it("wraps unexpected errors in PaymentError", () => {
      mockValidateAmount.mockImplementation(() => {
        throw new Error("oops");
      });
      expect(() =>
        service.getCrossCurrencyPaymentUnsignedTx(
          baseArgs.address,
          baseArgs.destination,
          baseArgs.amount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence
        )
      ).toThrow(expect.objectContaining({ code: "PaymentError" }));
    });
  });

  // ========== OfferCancel ==========

  describe("getOfferCancelUnsignedTx", () => {
    const baseArgs = {
      address: "rMaker",
      offerSequence: 42,
      fee: "10",
      sequence: 5,
      lastLedgerSequence: 15,
      memos: [{ Memo: { MemoType: "foo", MemoData: "bar" } }] as Memo[],
    };

    it("constructs OfferCancel tx with valid inputs", () => {
      const tx = service.getOfferCancelUnsignedTx(
        baseArgs.address,
        baseArgs.offerSequence,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence
      );
      expect(tx.TransactionType).toBe("OfferCancel");
      expect(tx.OfferSequence).toBe(baseArgs.offerSequence);
    });

    it("includes Memos when provided", () => {
      mockValidateMemos.mockReturnValue(baseArgs.memos);
      const tx = service.getOfferCancelUnsignedTx(
        baseArgs.address,
        baseArgs.offerSequence,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence,
        baseArgs.memos
      );
      expect(tx.Memos).toEqual(baseArgs.memos);
    });

    it("throws ValidationError for non-positive or non-integer offerSequence", () => {
      expect(() =>
        service.getOfferCancelUnsignedTx(
          baseArgs.address,
          0,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence
        )
      ).toThrow(ValidationError);
      expect(() =>
        service.getOfferCancelUnsignedTx(
          baseArgs.address,
          1.5 as any,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence
        )
      ).toThrow(ValidationError);
    });

    it("wraps unexpected errors as OfferCancelError", () => {
      mockValidateMemos.mockImplementation(() => {
        throw new Error("memos fail");
      });
      expect(() =>
        service.getOfferCancelUnsignedTx(
          baseArgs.address,
          baseArgs.offerSequence,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.memos
        )
      ).toThrow(expect.objectContaining({ code: "OfferCancelError" }));
    });
  });

  // ========== CredentialCreate ==========

  describe("getCredentialCreateUnsignedTx", () => {
    const baseArgs = {
      address: "rCred",
      fee: "10",
      sequence: 9,
      lastLedgerSequence: 99,
      subject: "rSubject",
      credentialType: "a1b2c3d4",
      expiration: 31415,
      uri: "abc123ef",
      flags: 0x80000000,
      memos: [{ Memo: { MemoType: "x", MemoData: "y" } }] as Memo[],
    };

    it("constructs CredentialCreate tx with all valid fields", () => {
      mockValidateMemos.mockImplementation((memos) => memos);
      isValidAddress.mockReturnValue(true);
      const tx = service.getCredentialCreateUnsignedTx(
        baseArgs.address,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence,
        baseArgs.subject,
        baseArgs.credentialType,
        baseArgs.expiration,
        baseArgs.uri,
        baseArgs.flags,
        baseArgs.memos
      );
      expect(tx.TransactionType).toBe("CredentialCreate");
      expect(tx.Subject).toBe(baseArgs.subject);
      expect(tx.CredentialType).toBe(baseArgs.credentialType);
      expect(tx.Expiration).toBe(baseArgs.expiration);
      expect(tx.URI).toBe(baseArgs.uri);
      expect(tx.Flags).toBe(baseArgs.flags);
      expect(tx.Memos).toEqual(baseArgs.memos);
    });

    it("omits optional fields when not provided", () => {
      isValidAddress.mockReturnValue(true);
      const tx = service.getCredentialCreateUnsignedTx(
        baseArgs.address,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence,
        baseArgs.subject,
        baseArgs.credentialType
      );
      expect(tx.Expiration).toBeUndefined();
      expect(tx.URI).toBeUndefined();
      expect(tx.Flags).toBeUndefined();
      expect(tx.Memos).toBeUndefined();
    });

    it("throws ValidationError if subject is invalid", () => {
      isValidAddress.mockReturnValue(false);
      expect(() =>
        service.getCredentialCreateUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          "badsubject",
          baseArgs.credentialType
        )
      ).toThrow(ValidationError);
    });

    it("throws ValidationError for invalid credentialType", () => {
      isValidAddress.mockReturnValue(true);
      expect(() =>
        service.getCredentialCreateUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.subject,
          "gibberishZ"
        )
      ).toThrow(ValidationError);
      expect(() =>
        service.getCredentialCreateUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.subject,
          "g".repeat(130)
        )
      ).toThrow(ValidationError);
    });

    it("throws ValidationError for invalid expiration", () => {
      isValidAddress.mockReturnValue(true);
      expect(() =>
        service.getCredentialCreateUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.subject,
          baseArgs.credentialType,
          -1
        )
      ).toThrow(ValidationError);
    });

    it("throws ValidationError for invalid uri", () => {
      isValidAddress.mockReturnValue(true);
      expect(() =>
        service.getCredentialCreateUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.subject,
          baseArgs.credentialType,
          undefined,
          "nohexZZ"
        )
      ).toThrow(ValidationError);

      expect(() =>
        service.getCredentialCreateUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.subject,
          baseArgs.credentialType,
          undefined,
          "f".repeat(513)
        )
      ).toThrow(ValidationError);
    });

    it("wraps unexpected errors as OfferCancelError", () => {
      isValidAddress.mockReturnValue(true);
      mockValidateMemos.mockImplementationOnce(() => {
        throw new Error("bad memo");
      });
      expect(() =>
        service.getCredentialCreateUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.subject,
          baseArgs.credentialType,
          baseArgs.expiration,
          baseArgs.uri,
          baseArgs.flags,
          baseArgs.memos
        )
      ).toThrow(expect.objectContaining({ code: "OfferCancelError" }));
    });
  });

  // ========== CredentialAccept ==========

  describe("getCredentialAcceptUnsignedTx", () => {
    const baseArgs = {
      address: "rAcc",
      fee: "12",
      sequence: 8,
      lastLedgerSequence: 22,
      issuer: "rIssuer",
      credentialType: "a1b2",
      flags: 0x80000000,
      memos: [{ Memo: { MemoType: "foo", MemoData: "bar" } }] as Memo[],
    };

    it("constructs CredentialAccept tx with all valid fields", () => {
      mockValidateMemos.mockImplementation((memos) => memos);
      isValidAddress.mockReturnValue(true);
      const tx = service.getCredentialAcceptUnsignedTx(
        baseArgs.address,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence,
        baseArgs.issuer,
        baseArgs.credentialType,
        baseArgs.flags,
        baseArgs.memos
      );
      expect(tx.TransactionType).toBe("CredentialAccept");
      expect(tx.Issuer).toBe(baseArgs.issuer);
      expect(tx.CredentialType).toBe(baseArgs.credentialType);
      expect(tx.Flags).toBe(baseArgs.flags);
      expect(tx.Memos).toEqual(baseArgs.memos);
    });

    it("omits optional fields when not provided", () => {
      isValidAddress.mockReturnValue(true);
      const tx = service.getCredentialAcceptUnsignedTx(
        baseArgs.address,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence,
        baseArgs.issuer,
        baseArgs.credentialType
      );
      expect(tx.Flags).toBeUndefined();
      expect(tx.Memos).toBeUndefined();
    });

    it("throws ValidationError if issuer is invalid", () => {
      isValidAddress.mockReturnValue(false);
      expect(() =>
        service.getCredentialAcceptUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          "notanaddress",
          baseArgs.credentialType
        )
      ).toThrow(ValidationError);
    });

    it("throws ValidationError for invalid credentialType", () => {
      isValidAddress.mockReturnValue(true);
      expect(() =>
        service.getCredentialAcceptUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.issuer,
          "gZ"
        )
      ).toThrow(ValidationError);
    });

    it("wraps unexpected errors as CredentialAcceptError", () => {
      isValidAddress.mockReturnValue(true);
      mockValidateMemos.mockImplementationOnce(() => {
        throw new Error("unexpected memo fail");
      });
      expect(() =>
        service.getCredentialAcceptUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.issuer,
          baseArgs.credentialType,
          baseArgs.flags,
          baseArgs.memos
        )
      ).toThrow(expect.objectContaining({ code: "CredentialAcceptError" }));
    });
  });

  // ========== CredentialDelete ==========

  describe("getCredentialDeleteUnsignedTx", () => {
    const baseArgs = {
      address: "rDel",
      fee: "12",
      sequence: 5,
      lastLedgerSequence: 15,
      credentialType: "aabbcc",
      issuer: "rIssuer",
      subject: "rSubject",
      flags: 0x80000000,
      memos: [{ Memo: { MemoType: "a", MemoData: "b" } }] as Memo[],
    };

    it("constructs CredentialDelete tx with issuer and subject", () => {
      mockValidateMemos.mockImplementation((memos) => memos);
      isValidAddress.mockReturnValue(true);
      const tx = service.getCredentialDeleteUnsignedTx(
        baseArgs.address,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence,
        baseArgs.credentialType,
        baseArgs.issuer,
        baseArgs.subject,
        baseArgs.flags,
        baseArgs.memos
      );
      expect(tx.TransactionType).toBe("CredentialDelete");
      expect(tx.Issuer).toBe(baseArgs.issuer);
      expect(tx.Subject).toBe(baseArgs.subject);
      expect(tx.Flags).toBe(baseArgs.flags);
      expect(tx.Memos).toEqual(baseArgs.memos);
    });

    it("constructs CredentialDelete tx with only issuer", () => {
      isValidAddress.mockReturnValue(true);
      const tx = service.getCredentialDeleteUnsignedTx(
        baseArgs.address,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence,
        baseArgs.credentialType,
        baseArgs.issuer
      );
      expect(tx.Issuer).toBe(baseArgs.issuer);
      expect(tx.Subject).toBeUndefined();
    });

    it("constructs CredentialDelete tx with only subject", () => {
      isValidAddress.mockReturnValue(true);
      const tx = service.getCredentialDeleteUnsignedTx(
        baseArgs.address,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence,
        baseArgs.credentialType,
        undefined,
        baseArgs.subject
      );
      expect(tx.Issuer).toBeUndefined();
      expect(tx.Subject).toBe(baseArgs.subject);
    });

    it("throws ValidationError if both issuer and subject are missing", () => {
      expect(() =>
        service.getCredentialDeleteUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.credentialType
        )
      ).toThrow(ValidationError);
    });

    it("throws ValidationError for missing credentialType", () => {
      expect(() =>
        service.getCredentialDeleteUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          ""
        )
      ).toThrow(ValidationError);
    });

    it("throws ValidationError for invalid credentialType", () => {
      expect(() =>
        service.getCredentialDeleteUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          "zz"
        )
      ).toThrow(ValidationError);

      expect(() =>
        service.getCredentialDeleteUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          "a".repeat(129)
        )
      ).toThrow(ValidationError);
    });

    it("throws ValidationError for invalid issuer/subject if provided", () => {
      isValidAddress.mockImplementation((address) => address === "rIssuer");
      expect(() =>
        service.getCredentialDeleteUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.credentialType,
          "notanaddress",
          baseArgs.subject
        )
      ).toThrow(ValidationError);

      isValidAddress.mockImplementation((address) => address === "rSubject");
      expect(() =>
        service.getCredentialDeleteUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.credentialType,
          baseArgs.issuer,
          "notanaddress"
        )
      ).toThrow(ValidationError);
    });

    it("wraps unexpected errors as CredentialDeleteError", () => {
      isValidAddress.mockReturnValue(true);
      mockValidateMemos.mockImplementationOnce(() => {
        throw new Error("memo boom");
      });
      expect(() =>
        service.getCredentialDeleteUnsignedTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.credentialType,
          baseArgs.issuer,
          baseArgs.subject,
          baseArgs.flags,
          baseArgs.memos
        )
      ).toThrow(expect.objectContaining({ code: "CredentialDeleteError" }));
    });
  });
});
