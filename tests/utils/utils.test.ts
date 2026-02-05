import {
  estimateNetworkFees,
  getAccountAndLedgerSequences,
  getSequencesAndFee,
  getNetworkParams,
  deriveAccountSetAsf,
  deriveAccountSetTf,
  hexEncodeDomain,
  validateAmount,
  deriveOfferCreateFlags,
  derivePaymentFlags,
  validateDestinationTag,
  validateMemos,
  ensureConnection,
  validateHash256,
} from "../../src/utils/utils";
import { MAX_DOMAIN_BYTES } from "../../src/utils/constants";
import { ValidationError, ClientError } from "../../src/errors/errors";
import { AccountSetTfFlags, PaymentFlags } from "xrpl";

const mockClient = {
  request: jest.fn(),
  isConnected: jest.fn(),
  connect: jest.fn(),
} as any;

afterEach(() => {
  jest.clearAllMocks();
});

describe("Utils", () => {
  describe("ensureConnection", () => {
    it("does nothing if already connected", async () => {
      mockClient.isConnected.mockReturnValue(true);
      await expect(ensureConnection(mockClient)).resolves.toBeUndefined();
      expect(mockClient.connect).not.toHaveBeenCalled();
    });
    it("calls connect if not connected", async () => {
      mockClient.isConnected.mockReturnValue(false);
      mockClient.connect.mockResolvedValue();
      await expect(ensureConnection(mockClient)).resolves.toBeUndefined();
      expect(mockClient.connect).toHaveBeenCalled();
    });
    it("throws if connect throws", async () => {
      mockClient.isConnected.mockReturnValue(false);
      mockClient.connect.mockRejectedValue(new Error("fail"));
      await expect(ensureConnection(mockClient)).rejects.toThrow(
        /Failed to establish client connection/
      );
    });
  });

  describe("estimateNetworkFees", () => {
    it("returns estimated fee on valid response", async () => {
      mockClient.request.mockResolvedValue({
        result: {
          state: {
            validated_ledger: { base_fee: 10 },
            load_factor: 3,
            load_base: 2,
          },
        },
      });
      const fee = await estimateNetworkFees(mockClient);
      expect(fee).toBe(((10 * 3) / 2).toString());
    });
    it("throws ClientError if server state is missing", async () => {
      mockClient.request.mockResolvedValue({ result: {} });
      await expect(estimateNetworkFees(mockClient)).rejects.toThrow(
        ClientError
      );
    });
    it("throws ClientError if required fields are missing", async () => {
      mockClient.request.mockResolvedValue({
        result: {
          state: {},
        },
      });
      await expect(estimateNetworkFees(mockClient)).rejects.toThrow(
        ClientError
      );
    });
    it("wraps non-ClientError exceptions in generic Error", async () => {
      mockClient.request.mockRejectedValue(new Error("Some error"));
      await expect(estimateNetworkFees(mockClient)).rejects.toThrow(
        "Failed to estimate network fees: Some error"
      );
    });
  });

  describe("getAccountAndLedgerSequences", () => {
    it("returns sequence and ledgerCurrentIndex for valid response", async () => {
      mockClient.request.mockResolvedValue({
        result: {
          account_data: { Sequence: 123 },
          ledger_current_index: 456,
        },
      });
      const res = await getAccountAndLedgerSequences(mockClient, "rAddress");
      expect(res).toEqual({ sequence: 123, ledgerCurrentIndex: 456 });
    });
    it("throws ValidationError for invalid address", async () => {
      await expect(
        getAccountAndLedgerSequences(mockClient, undefined as any)
      ).rejects.toThrow(ValidationError);
      await expect(
        getAccountAndLedgerSequences(mockClient, "")
      ).rejects.toThrow(ValidationError);
    });
    it("throws ClientError if required fields missing", async () => {
      mockClient.request.mockResolvedValue({
        result: { account_data: {}, ledger_current_index: undefined },
      });
      await expect(
        getAccountAndLedgerSequences(mockClient, "rAddress")
      ).rejects.toThrow(ClientError);
    });
    it("wraps non-ClientError exceptions", async () => {
      mockClient.request.mockRejectedValue(new Error("test error"));
      await expect(
        getAccountAndLedgerSequences(mockClient, "rAddress")
      ).rejects.toThrow(
        "Failed to fetch account and ledger sequences: test error"
      );
    });
  });

  describe("getSequencesAndFee", () => {
    it("throws ValidationError if client is missing", async () => {
      await expect(getSequencesAndFee(undefined as any, "rA")).rejects.toThrow(
        ValidationError
      );
    });
    it("throws ValidationError if address is missing", async () => {
      await expect(getSequencesAndFee(mockClient, "")).rejects.toThrow(
        ValidationError
      );
    });
    it("calls ensureConnection and returns network params", async () => {
      mockClient.isConnected.mockReturnValue(true);
      jest
        .spyOn(require("../../src/utils/utils"), "estimateNetworkFees")
        .mockResolvedValue("11");
      jest
        .spyOn(require("../../src/utils/utils"), "getAccountAndLedgerSequences")
        .mockResolvedValue({ sequence: 1, ledgerCurrentIndex: 22 });
      const out = await getSequencesAndFee(mockClient, "rAddress");
      expect(out).toEqual({ fee: "11", sequence: 1, lastLedgerSequence: 42 });
    });
    it("throws if estimateNetworkFees throws non-ValidationError", async () => {
      mockClient.isConnected.mockReturnValue(true);
      jest
        .spyOn(require("../../src/utils/utils"), "estimateNetworkFees")
        .mockRejectedValue(new Error("fail"));
      jest
        .spyOn(require("../../src/utils/utils"), "getAccountAndLedgerSequences")
        .mockResolvedValue({ sequence: 1, ledgerCurrentIndex: 22 });
      await expect(getSequencesAndFee(mockClient, "rAddress")).rejects.toThrow(
        /Failed to get network parameters/
      );
    });
  });

  describe("getNetworkParams", () => {
    it("returns on first attempt if no errors", async () => {
      jest
        .spyOn(require("../../src/utils/utils"), "getSequencesAndFee")
        .mockResolvedValue({ fee: "1", sequence: 2, lastLedgerSequence: 3 });
      const out = await getNetworkParams(mockClient, "addr");
      expect(out).toEqual({ fee: "1", sequence: 2, lastLedgerSequence: 3 });
    });
    it("retries and succeeds after one failure", async () => {
      const spy = jest
        .spyOn(require("../../src/utils/utils"), "getSequencesAndFee")
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce({
          fee: "2",
          sequence: 4,
          lastLedgerSequence: 5,
        });
      const out = await getNetworkParams(mockClient, "addr", 2, 1);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(out).toEqual({ fee: "2", sequence: 4, lastLedgerSequence: 5 });
    });
    it("throws after maxRetries", async () => {
      jest
        .spyOn(require("../../src/utils/utils"), "getSequencesAndFee")
        .mockRejectedValue(new Error("fail"));
      await expect(getNetworkParams(mockClient, "addr", 2, 1)).rejects.toThrow(
        /Failed to get network parameters after 2 attempts/
      );
    });
    it("does not retry on ValidationError", async () => {
      jest
        .spyOn(require("../../src/utils/utils"), "getSequencesAndFee")
        .mockRejectedValue(new ValidationError("x", "fail"));
      await expect(getNetworkParams(mockClient, "addr", 2, 1)).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe("hexEncodeDomain", () => {
    it("returns hex string for valid ascii domain (uppercase, per SDK)", () => {
      expect(hexEncodeDomain("example.com")).toBe(
        Buffer.from("example.com", "utf8").toString("hex").toUpperCase()
      );
    });
    it("throws ValidationError for domain exceeding max length (512 hex chars)", () => {
      const longDomain = "a".repeat(MAX_DOMAIN_BYTES + 1);
      expect(() => hexEncodeDomain(longDomain)).toThrow(ValidationError);
    });
    it("throws ValidationError for non-ascii domains", () => {
      expect(() => hexEncodeDomain("exámple.com")).toThrow(ValidationError);
    });
  });

  describe("validateAmount", () => {
    it("accepts valid amount for XRP and issued currencies (XRPL-valid address)", () => {
      expect(() =>
        validateAmount("Amount", {
          currency: "USD",
          issuer: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
          value: "100",
        })
      ).not.toThrow();
      expect(() => validateAmount("Amount", "100")).not.toThrow();
    });
    it("throws ValidationError for negative or zero amount", () => {
      expect(() =>
        validateAmount("Amount", {
          currency: "USD",
          issuer: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
          value: "-1",
        })
      ).toThrow(ValidationError);
      expect(() => validateAmount("Amount", "0")).toThrow(ValidationError);
      // Zero should throw by default
      expect(() =>
        validateAmount("Amount", {
          currency: "USD",
          issuer: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
          value: "0",
        })
      ).toThrow(ValidationError);
    });
    it("allows zero amount when allowZero is true", () => {
      expect(() =>
        validateAmount(
          "Amount",
          {
            currency: "USD",
            issuer: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
            value: "0",
          },
          true
        )
      ).not.toThrow();
      // Negative should still throw even with allowZero
      expect(() =>
        validateAmount(
          "Amount",
          {
            currency: "USD",
            issuer: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
            value: "-1",
          },
          true
        )
      ).toThrow(ValidationError);
    });
    it("throws ValidationError for invalid amount object", () => {
      expect(() =>
        validateAmount("Amount", { currency: "USD", value: "100" } as any)
      ).toThrow(ValidationError);
    });
  });

  describe("deriveAccountSetAsf", () => {
    it("returns correct object with SetFlag or ClearFlag", () => {
      expect(deriveAccountSetAsf({ asfRequireAuth: true }, {})).toEqual({
        SetFlag: 2,
        ClearFlag: undefined,
      });
      expect(deriveAccountSetAsf({}, { asfDisableMaster: true })).toEqual({
        SetFlag: undefined,
        ClearFlag: 4,
      });
    });
    it("throws ValidationError for more than one flag in set or clear", () => {
      expect(() =>
        deriveAccountSetAsf(
          { asfRequireAuth: true, asfDisableMaster: true },
          {}
        )
      ).toThrow(ValidationError);
      expect(() =>
        deriveAccountSetAsf(
          {},
          { asfRequireAuth: true, asfDisableMaster: true }
        )
      ).toThrow(ValidationError);
    });
  });

  describe("deriveAccountSetTf", () => {
    it("returns correct combined flag value or undefined if empty", () => {
      expect(deriveAccountSetTf({ tfRequireDestTag: true })).toBe(
        AccountSetTfFlags.tfRequireDestTag
      );
      expect(
        deriveAccountSetTf({ tfRequireDestTag: true, tfDisallowXRP: true })
      ).toBe(
        AccountSetTfFlags.tfRequireDestTag | AccountSetTfFlags.tfDisallowXRP
      );
      expect(deriveAccountSetTf({})).toBe(undefined);
      expect(deriveAccountSetTf()).toBe(undefined);
    });
  });

  describe("deriveOfferCreateFlags", () => {
    it("returns undefined for no flags", () => {
      expect(deriveOfferCreateFlags({})).toBeUndefined();
    });
    it("throws for mutually exclusive flags", () => {
      expect(() =>
        deriveOfferCreateFlags({
          tfImmediateOrCancelOffer: true,
          tfFillOrKillOffer: true,
        })
      ).toThrow(ValidationError);
    });
    it("returns correct bitmask", () => {
      expect(
        deriveOfferCreateFlags({ tfSellOffer: true, tfFillOrKillOffer: true })
      ).toBeGreaterThan(0);
    });
  });

  describe("derivePaymentFlags", () => {
    it("returns correct combined flag value or undefined if empty", () => {
      expect(
        derivePaymentFlags({ tfPartialPayment: true, tfLimitQuality: true })
      ).toBe(
        (PaymentFlags.tfPartialPayment || 0) |
          (PaymentFlags.tfLimitQuality || 0)
      );
      expect(derivePaymentFlags({})).toBe(undefined);
    });
  });

  describe("validateDestinationTag", () => {
    it("accepts valid tag", () => {
      expect(() => validateDestinationTag(1234)).not.toThrow();
    });
    it("throws ValidationError for negative, too large, or non-integer", () => {
      expect(() => validateDestinationTag(-1)).toThrow(ValidationError);
      expect(() => validateDestinationTag(2 ** 32)).toThrow(ValidationError);
      expect(() => validateDestinationTag(12.34)).toThrow(ValidationError);
    });
  });

  describe("validateMemos", () => {
    it("returns valid memos mapped to SDK format", () => {
      const memos = [{ MemoData: "bar", MemoType: "foo" }];
      const result = validateMemos(memos);
      expect(result && Array.isArray(result)).toBe(true);
      expect(result && result[0].Memo.MemoData).toBe("bar");
      expect(result && result[0].Memo.MemoType).toBe("foo");
    });
    it("returns undefined for undefined or empty memos", () => {
      expect(validateMemos(undefined as any)).toBeUndefined();
      expect(validateMemos([])).toBeUndefined();
    });
    it("throws ValidationError for non-array", () => {
      expect(() => validateMemos(123 as any)).toThrow(ValidationError);
    });
    it("throws ValidationError for memos missing all fields", () => {
      expect(() => validateMemos([{ NoMemoFields: true }])).toThrow(
        ValidationError
      );
    });
    it("throws ValidationError for non-object memo", () => {
      expect(() => validateMemos([null as any])).toThrow(ValidationError);
      expect(() => validateMemos(["bad" as any])).toThrow(ValidationError);
    });
    it("throws ValidationError for invalid MemoData/Type/Format types", () => {
      expect(() => validateMemos([{ MemoData: 123, MemoType: "foo" }])).toThrow(
        ValidationError
      );
      expect(() => validateMemos([{ MemoType: 123, MemoData: "foo" }])).toThrow(
        ValidationError
      );
      expect(() =>
        validateMemos([{ MemoFormat: 123, MemoData: "foo" }])
      ).toThrow(ValidationError);
    });
  });
  describe("validateHash256", () => {
    it("accepts valid hash256 strings", () => {
      expect(() =>
        validateHash256(
          "DomainID",
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        )
      ).not.toThrow();

      expect(() =>
        validateHash256(
          "DomainID",
          "AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899"
        )
      ).not.toThrow();
    });

    it("throws ValidationError for non-hex or wrong length", () => {
      // Too short
      expect(() => validateHash256("DomainID", "abc123")).toThrow(
        ValidationError
      );

      // Too long
      expect(() => validateHash256("DomainID", "a".repeat(65))).toThrow(
        ValidationError
      );

      // Not hex
      expect(() =>
        validateHash256(
          "DomainID",
          "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg"
        )
      ).toThrow(ValidationError);

      // Not string
      expect(() => validateHash256("DomainID", 123 as any)).toThrow(
        ValidationError
      );
    });
  });
});
