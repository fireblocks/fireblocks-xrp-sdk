import { FbksXrpApiService, ClawbackOpts, TransactionType } from "../src/";
import { BasePath } from "@fireblocks/ts-sdk";
import { ExecuteTransactionOpts } from "../src/config/types";

(async () => {
  const apiService = new FbksXrpApiService({
    apiKey: process.env.FIREBLOCKS_API_KEY || "",
    apiSecret: process.env.FIREBLOCKS_API_SECRET || "",
    assetId: process.env.FIREBLOCKS_ASSET_ID || "XRP_TEST",
    basePath: (process.env.FIREBLOCKS_BASE_PATH as BasePath) || BasePath.US,
  });
  try {
    // Specify the token holder, currency, and amount to claw back. The issuer is not needed as it will be set dynamically as sdk.address
    const params: ClawbackOpts = {
      holder: "rNZxC1fL1qREWqu9N5A74nHWwqo39XoNYB",
      currency: "FBX",
      value: "55",
    };

    const opts: ExecuteTransactionOpts = {
      vaultAccountId: process.env.FIREBLOCKS_VAULT_ACCOUNT_ID || "",
      transactionType: TransactionType.CLAWBACK,
      params,
    };
    const res = await apiService.executeTransaction(opts);

    // Need to check which type of response we got
    if ("result" in res) {
      // This is a TxResponse from XRPL
      if (
        typeof res.result.meta === "object" &&
        res.result.meta?.TransactionResult !== "tesSUCCESS"
      ) {
        console.log(
          `Tx submission failed with result: ${res.result.meta.TransactionResult}`
        );
      } else {
        console.log(`Tx submitted successfully with hash: ${res.result.hash}`);
        console.log(`Tx metadata: ${JSON.stringify(res.result.meta, null, 2)}`);
      }
    } else {
      // This is a TransactionResponse from Fireblocks
      console.log(`Transaction submitted with ID: ${res.id}`);
      console.log(`Status: ${res.status}`);
      if (res.txHash) {
        console.log(`Transaction hash: ${res.txHash}`);
      }
    }
  } catch (error) {
    console.error("Error in offerCreate example:", error);
  } finally {
    await apiService.shutdown();
  }
})();
