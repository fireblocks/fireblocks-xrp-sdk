// tests/services/TokenService.test.ts
import { TokenService } from "../../src/services";
import { ValidationError } from "../../src/errors/errors";
import { isValidAddress } from "xrpl";
import {
  validateAmount,
  validateDestinationTag,
  validateMemos,
} from "../../src/utils/utils";

// Mocks
jest.mock("xrpl", () => ({
  isValidAddress: jest.fn(),
  PaymentFlags: {
    tfPartialPayment: 0x00020000,
    tfNoRippleDirect: 0x00010000,
    tfLimitQuality: 0x00040000,
  },
  AccountSetAsfFlags: {
    asfRequireAuth: 3,
    asfDefaultRipple: 8,
    asfAllowTrustLineClawback: 9,
    asfDisableMaster: 4,
  },
  AccountSetTfFlags: {
    tfRequireDestTag: 1,
    tfDisallowXRP: 3,
    tfRequireAuth: 2,
    tfAllowXRP: 4,
  },
}));

jest.mock("../../src/utils/utils", () => ({
  ...jest.requireActual("../../src/utils/utils"),
  validateAmount: jest.fn(),
  validateDestinationTag: jest.fn(),
  validateMemos: jest.fn((memos) => memos),
}));

const mockIsValidAddress = isValidAddress as jest.Mock;
const mockValidateAmount = validateAmount as jest.Mock;
const mockValidateDestinationTag = validateDestinationTag as jest.Mock;
const mockValidateMemos = validateMemos as jest.Mock;

describe("TokenService", () => {
  let service: TokenService;

  beforeEach(() => {
    service = new TokenService();
    jest.clearAllMocks();
  });

  // ---- createFungibleTokenPaymentTx ----
  describe("createFungibleTokenPaymentTx", () => {
    const baseArgs = {
      address: "rIssuer",
      destination: "rDest",
      amount: { currency: "USD", issuer: "rIssuer", value: "100" },
      fee: "12",
      sequence: 1,
      lastLedgerSequence: 2,
      flags: { tfPartialPayment: true },
      memos: [{ Memo: { MemoType: "foo", MemoData: "bar" } }],
      destinationTag: 123,
      invoiceId: "A".repeat(64),
      sendMax: { currency: "USD", issuer: "rIssuer", value: "101" },
      deliverMin: { currency: "USD", issuer: "rIssuer", value: "99" },
      paths: [],
    };

    it("constructs payment tx with all valid inputs", () => {
      mockIsValidAddress.mockReturnValue(true);
      mockValidateAmount.mockReturnValue(undefined);
      mockValidateMemos.mockReturnValue(baseArgs.memos);

      const tx = service.createFungibleTokenPaymentTx(
        baseArgs.address,
        baseArgs.destination,
        baseArgs.amount,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence,
        baseArgs.flags,
        baseArgs.memos,
        baseArgs.destinationTag,
        baseArgs.invoiceId,
        baseArgs.sendMax,
        baseArgs.deliverMin,
        baseArgs.paths
      );

      expect(tx.TransactionType).toBe("Payment");
      expect(tx.Account).toBe(baseArgs.address);
      expect(tx.Destination).toBe(baseArgs.destination);
      expect(tx.Amount).toEqual(baseArgs.amount);
      expect(tx.Fee).toBe(baseArgs.fee);
      expect(tx.Sequence).toBe(baseArgs.sequence);
      expect(tx.LastLedgerSequence).toBe(baseArgs.lastLedgerSequence);
      expect(tx.Memos).toEqual(baseArgs.memos);
      expect(tx.DestinationTag).toBe(baseArgs.destinationTag);
      expect(tx.InvoiceID).toBe(baseArgs.invoiceId);
      expect(tx.SendMax).toEqual(baseArgs.sendMax);
      expect(tx.DeliverMin).toEqual(baseArgs.deliverMin);
      expect(tx.Paths).toEqual(baseArgs.paths);
    });

    it("throws ValidationError if destination address is invalid", () => {
      mockIsValidAddress.mockReturnValue(false);
      expect(() =>
        service.createFungibleTokenPaymentTx(
          baseArgs.address,
          baseArgs.destination,
          baseArgs.amount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence
        )
      ).toThrow(ValidationError);
    });

    it("throws ValidationError if amount is a string (not token)", () => {
      mockIsValidAddress.mockReturnValue(true);
      expect(() =>
        service.createFungibleTokenPaymentTx(
          baseArgs.address,
          baseArgs.destination,
          "100" as any, // XRP payments not allowed
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence
        )
      ).toThrow(ValidationError);
    });

    it("throws ValidationError for bad destinationTag", () => {
      mockIsValidAddress.mockReturnValue(true);
      expect(() =>
        service.createFungibleTokenPaymentTx(
          baseArgs.address,
          baseArgs.destination,
          baseArgs.amount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.flags,
          baseArgs.memos,
          -1
        )
      ).toThrow(ValidationError);

      expect(() =>
        service.createFungibleTokenPaymentTx(
          baseArgs.address,
          baseArgs.destination,
          baseArgs.amount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.flags,
          baseArgs.memos,
          2 ** 32
        )
      ).toThrow(ValidationError);
    });

    it("throws ValidationError for bad invoiceId", () => {
      mockIsValidAddress.mockReturnValue(true);
      expect(() =>
        service.createFungibleTokenPaymentTx(
          baseArgs.address,
          baseArgs.destination,
          baseArgs.amount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence,
          baseArgs.flags,
          baseArgs.memos,
          undefined,
          "bad-invoice-id"
        )
      ).toThrow(ValidationError);
    });

    it("omits optional fields when not provided", () => {
      mockIsValidAddress.mockReturnValue(true);
      const tx = service.createFungibleTokenPaymentTx(
        baseArgs.address,
        baseArgs.destination,
        baseArgs.amount,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence
      );
      expect(tx.SendMax).toBeUndefined();
      expect(tx.DeliverMin).toBeUndefined();
      expect(tx.InvoiceID).toBeUndefined();
      expect(tx.Paths).toBeUndefined();
      expect(tx.DestinationTag).toBeUndefined();
      expect(tx.Memos).toBeUndefined();
    });
  });

  // ---- createTrustSetTx ----
  describe("createTrustSetTx", () => {
    const baseArgs = {
      address: "rValidAddress",
      fee: "12",
      sequence: 2,
      limitAmount: { currency: "USD", issuer: "rIssuer", value: "100" },
      lastLedgerSequence: 22,
      flags: { tfSetNoRipple: true },
      qualityIn: 5,
      qualityOut: 10,
      memos: [{ Memo: { MemoType: "foo", MemoData: "bar" } }],
    };

    it("constructs trustset tx with all valid inputs", () => {
      mockIsValidAddress.mockReturnValue(true);
      mockValidateAmount.mockReturnValue(undefined);
      mockValidateMemos.mockReturnValue(baseArgs.memos);
      const tx = service.createTrustSetTx(
        baseArgs.address,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.limitAmount,
        baseArgs.lastLedgerSequence,
        baseArgs.flags,
        baseArgs.qualityIn,
        baseArgs.qualityOut,
        baseArgs.memos
      );
      expect(tx.TransactionType).toBe("TrustSet");
      expect(tx.Account).toBe(baseArgs.address);
      expect(tx.Fee).toBe(baseArgs.fee);
      expect(tx.Sequence).toBe(baseArgs.sequence);
      expect(tx.LimitAmount).toEqual(baseArgs.limitAmount);
      expect(tx.LastLedgerSequence).toBe(baseArgs.lastLedgerSequence);
      expect(tx.Memos).toEqual(baseArgs.memos);
      expect(tx.QualityIn).toBe(baseArgs.qualityIn);
      expect(tx.QualityOut).toBe(baseArgs.qualityOut);
    });

    it("throws ValidationError if limitAmount is invalid", () => {
      mockIsValidAddress.mockReturnValue(true);
      mockValidateAmount.mockImplementation(() => {
        throw new ValidationError("InvalidAmount", "Bad limitAmount");
      });
      expect(() =>
        service.createTrustSetTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.limitAmount,
          baseArgs.lastLedgerSequence
        )
      ).toThrow(ValidationError);
    });

    it("omits optional fields when not provided", () => {
      mockIsValidAddress.mockReturnValue(true);
      mockValidateAmount.mockReturnValue(undefined);
      const tx = service.createTrustSetTx(
        baseArgs.address,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.limitAmount,
        baseArgs.lastLedgerSequence
      );
      expect(tx.QualityIn).toBeUndefined();
      expect(tx.QualityOut).toBeUndefined();
      expect(tx.Memos).toBeUndefined();
      expect(tx.Flags).toBeUndefined();
    });

    it("throws if tfSetNoRipple and tfClearNoRipple are both true", () => {
      mockIsValidAddress.mockReturnValue(true);
      expect(() =>
        service.createTrustSetTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.limitAmount,
          baseArgs.lastLedgerSequence,
          { tfSetNoRipple: true, tfClearNoRipple: true }
        )
      ).toThrow("Cannot both set and clear NoRipple on same trust line.");
    });

    it("throws if tfSetFreeze and tfClearFreeze are both true", () => {
      mockIsValidAddress.mockReturnValue(true);
      expect(() =>
        service.createTrustSetTx(
          baseArgs.address,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.limitAmount,
          baseArgs.lastLedgerSequence,
          { tfSetFreeze: true, tfClearFreeze: true }
        )
      ).toThrow(ValidationError);
    });

    it("allows zero value limitAmount for TrustSet (to delete trustline)", () => {
      mockIsValidAddress.mockReturnValue(true);
      mockValidateAmount.mockReturnValue(undefined);
      const zeroLimitAmount = {
        currency: "USD",
        issuer: "rIssuer",
        value: "0",
      };
      const tx = service.createTrustSetTx(
        baseArgs.address,
        baseArgs.fee,
        baseArgs.sequence,
        zeroLimitAmount,
        baseArgs.lastLedgerSequence
      );
      expect(tx.TransactionType).toBe("TrustSet");
      expect(tx.LimitAmount).toEqual(zeroLimitAmount);
      // Verify validateAmount was called with allowZero=true (third parameter)
      expect(mockValidateAmount).toHaveBeenCalledWith(
        "LimitAmount",
        zeroLimitAmount,
        true
      );
    });
  });

  // ---- createAccountSetTx ----
  describe("createAccountSetTx", () => {
    const baseArgs = {
      address: "rAccount",
      fee: "15",
      sequence: 11,
      lastLedgerSequence: 21,
      configs: {
        setFlag: { asfRequireAuth: true },
        tfFlags: { tfAllowXRP: true },
      },
      memos: [{ Memo: { MemoType: "foo", MemoData: "bar" } }],
    };

    it("constructs accountset tx with all valid inputs", () => {
      mockValidateMemos.mockReturnValue(baseArgs.memos);
      const tx = service.createAccountSetTx(
        baseArgs.address,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence,
        baseArgs.configs,
        baseArgs.memos
      );
      expect(tx.TransactionType).toBe("AccountSet");
      expect(tx.Account).toBe(baseArgs.address);
      expect(tx.Fee).toBe(baseArgs.fee);
      expect(tx.Sequence).toBe(baseArgs.sequence);
      expect(tx.LastLedgerSequence).toBe(baseArgs.lastLedgerSequence);
      expect(tx.Memos).toEqual(baseArgs.memos);
      expect(tx.SetFlag).toBeDefined();
    });

    it("builds AccountSet with all optional fields", () => {
      mockValidateMemos.mockReturnValue([
        { Memo: { MemoType: "a", MemoData: "b" } },
      ]);
      const tx = service.createAccountSetTx(
        "rValidAddress",
        "15",
        10,
        999,
        {
          setFlag: { asfDefaultRipple: true },
          clearFlag: { asfRequireAuth: true },
          tfFlags: { tfRequireDestTag: true },
          domain: "fireblocks.com",
          transferRate: 1500000000,
          tickSize: 10,
          emailHash: "a".repeat(32),
          messageKey: "02" + "A".repeat(64),
        },
        [{ Memo: { MemoType: "a", MemoData: "b" } }]
      );
      expect(tx.TransactionType).toBe("AccountSet");
      expect(tx.Domain).toBeDefined();
      expect(tx.TransferRate).toBe(1500000000);
      expect(tx.TickSize).toBe(10);
      expect(tx.EmailHash).toBe("a".repeat(32));
      expect(tx.MessageKey).toBe("02" + "A".repeat(64));
    });

    it("omits optional memos when not provided", () => {
      const tx = service.createAccountSetTx(
        baseArgs.address,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence,
        baseArgs.configs
      );
      expect(tx.Memos).toBeUndefined();
    });
  });

  // ---- createClawbackTx ----
  describe("createClawbackTx", () => {
    const baseArgs = {
      address: "rAccount",
      amount: { currency: "USD", issuer: "rIssuer", value: "50" },
      fee: "20",
      sequence: 13,
      lastLedgerSequence: 31,
      memos: [{ Memo: { MemoType: "foo", MemoData: "bar" } }],
    };

    it("constructs clawback tx with all valid inputs", () => {
      mockIsValidAddress.mockReturnValue(true);
      mockValidateAmount.mockReturnValue(undefined);
      mockValidateMemos.mockReturnValue(baseArgs.memos);
      const tx = service.createClawbackTx(
        baseArgs.address,
        baseArgs.amount,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence,
        baseArgs.memos
      );
      expect(tx.TransactionType).toBe("Clawback");
      expect(tx.Account).toBe(baseArgs.address);
      expect(tx.Amount).toEqual(baseArgs.amount);
      expect(tx.Fee).toBe(baseArgs.fee);
      expect(tx.Sequence).toBe(baseArgs.sequence);
      expect(tx.LastLedgerSequence).toBe(baseArgs.lastLedgerSequence);
      expect(tx.Memos).toEqual(baseArgs.memos);
    });

    it("throws ValidationError if amount is invalid", () => {
      mockIsValidAddress.mockReturnValue(true);
      mockValidateAmount.mockImplementation(() => {
        throw new ValidationError("InvalidAmount", "Bad clawback amount");
      });
      expect(() =>
        service.createClawbackTx(
          baseArgs.address,
          baseArgs.amount,
          baseArgs.fee,
          baseArgs.sequence,
          baseArgs.lastLedgerSequence
        )
      ).toThrow(ValidationError);
    });

    it("omits optional memos when not provided", () => {
      mockIsValidAddress.mockReturnValue(true);
      mockValidateAmount.mockReturnValue(undefined);
      const tx = service.createClawbackTx(
        baseArgs.address,
        baseArgs.amount,
        baseArgs.fee,
        baseArgs.sequence,
        baseArgs.lastLedgerSequence
      );
      expect(tx.Memos).toBeUndefined();
    });
  });
});
