const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs");
const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("https-proxy-agent");
const chalk = require("chalk");
const delay = require("delay");
const url = "https://api-crewdrop.cartawallet.com/v1/graphql";
const queryFilePath = "auth.txt";
const proxy = "proxy.txt";
function generateRandom(min, max) {
  return Math.random() * (max - min) + min;
}
function generateRandomHexString(length) {
  // Menghasilkan byte acak dengan panjang yang sesuai, lalu konversi ke string heksadesimal
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
}
function generateRandomNumbers(count, min, max) {
  const randomNumbers = [];
  for (let i = 0; i < count; i++) {
    randomNumbers.push(generateRandom(min, max));
  }
  return randomNumbers;
}

// Menghasilkan 3 angka acak dalam rentang -3 hingga 3
async function payloadGame() {
  let datagame = [];
  const random = generateRandom(100, 300);
  for (let index = 0; index < random; index++) {
    datagame.push({
      id: `01921db8-cb5b-700a-${generateRandomHexString(
        4
      )}-${generateRandomHexString(12)}`,
      type: "c",
      points: 1,
      position: generateRandomNumbers(3, -3, 2),
      time: Date.now(),
    });
    await delay(60000 / random);
  }
  return datagame;
}
function hexToBytes(hex) {
  return Buffer.from(hex, "hex");
}

// Konversi byte array menjadi Base64 string
function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

// Konversi string UTF-8 ke byte array
function utf8ToBytes(str) {
  return Buffer.from(str, "utf8");
}

// Fungsi utama untuk enkripsi
async function encryptData(data, keys) {
  const Wn = JSON.stringify(data, null, 0);
  const Tn = crypto.randomBytes(12);
  const key = hexToBytes(keys);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, Tn);
  let encrypted = cipher.update(Wn, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  const Hn = Buffer.concat([Tn, encrypted, authTag]);
  const Pn = bytesToBase64(Hn);
  return Pn;
}
function log(msg, type = "info") {
  const timestamp = new Date().toLocaleTimeString();
  switch (type) {
    case "success":
      console.log(`[${timestamp}] ➤  ${chalk.green(msg)}`);
      break;
    case "custom":
      console.log(`[${timestamp}] ➤  ${chalk.magenta(msg)}`);
      break;
    case "error":
      console.log(`[${timestamp}] ➤  ${chalk.red(msg)}`);
      break;
    case "warning":
      console.log(`[${timestamp}] ➤  ${chalk.yellow(msg)}`);
      break;
    default:
      console.log(`[${timestamp}] ➤  ${msg}`);
  }
}
function readQueryIdsFromFile() {
  try {
    const queryContent = fs.readFileSync(queryFilePath, "utf-8");
    return queryContent
      .split("\n")
      .map((query) => query.trim())
      .filter((query) => query); // Ensure to remove extra newlines or spaces
  } catch (error) {
    console.error(chalk.red(`Error reading ${queryFilePath}:`), error);
    return [];
  }
}
async function makeRequest(url, body = null, headers = {}, proxy = null) {
  return new Promise((resolve, reject) => {
    // Tentukan opsi untuk fetch
    const options = {
      method: body ? "POST" : "GET",
      headers: {
        accept:
          "application/graphql-response+json, application/graphql+json, application/json, text/event-stream, multipart/mixed",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/json",
        origin: "https://crewdrop.cartawallet.com",
        priority: "u=1, i",
        referer: "https://crewdrop.cartawallet.com/",
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
        ...headers,
      },
      body: body ? body : undefined,
    };

    // Jika proxy disediakan, atur agent
    if (proxy) {
      options.agent = new HttpsProxyAgent(proxy);
    }

    fetch(url, options)
      .then((response) => {
        // Validasi status response
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => resolve(data)) // Resolving the promise with data
      .catch((error) => {
        reject(error); // Rejecting the promise with error
      });
  });
}
async function processChunkedData(queryIds, chunkSize = 20) {
  for (let i = 0; i < queryIds.length; i += chunkSize) {
    const queryContent = fs.readFileSync(proxy, "utf-8");
    const chunk = queryIds.slice(i, i + chunkSize); // Ambil chunk data dengan batasan 20 item
    const promises = chunk.map(async (query, index) => {
      try {
        const regex = /"id":(\d+)/;
        const match = decodeURIComponent(query).match(regex);
        const id = match[1];
        const bearerToken = await makeRequest(
          url,
          JSON.stringify({
            operationName: "authenticate",
            query:
              "mutation authenticate($initDataRaw: String!) {\n  authenticate(initDataRaw: $initDataRaw) {\n    accessToken\n    __typename\n  }\n}",
            variables: {
              initDataRaw: query,
            },
          }),
          {},
          queryContent
        );
        if (bearerToken.data.authenticate.accessToken) {
          log(`get token sucessfully akun ke [${index}]`, "success");
          const token = bearerToken.data.authenticate.accessToken;
          const decoded = jwt.decode(token);
          const key = decoded.claims["x-hasura-user-hash"];
          const access_token = bearerToken.data.authenticate.accessToken;
          const accoutt = await makeRequest(
            url,
            JSON.stringify({
              operationName: "getMyData",
              query:
                'query getMyData($userId: bigint = \n"") {\n  user: userByPk(id: $userId) {\n    ...User\n    __typename\n  }\n}\nfragment User on User {\n  id\n  createdAt\n  balance\n  isAllowPm\n  lastClaimReferralAt\n  referralCode\n  referredByCode\n  turn\n  updatedAt\n  __typename\n}',
              variables: { userId: parseFloat(id) },
            }),
            { authorization: `Bearer ${access_token}` },
            queryContent
          );
          if (accoutt.data) {
            log(`user id   : ${accoutt.data.user.id}`, "custom");
            log(`balance   : ${accoutt.data.user.balance}`, "custom");
            log(`createdAt : ${accoutt.data.user.createdAt}`, "custom");
            log(`play game : ${accoutt.data.user.turn}`, "custom");

            const listask = await makeRequest(
              url,
              JSON.stringify({
                operationName: "getTasks",
                query:
                  "query getTasks {\n  tasks: task {\n    ...Task\n    __typename\n  }\n}\nfragment Task on Task {\n  id\n  frequency\n  action\n  createdAt\n  status\n  name\n  point\n  turn\n  updatedAt\n  value\n  __typename\n}",
                variables: {},
              }),
              { authorization: `Bearer ${access_token}` },
              queryContent
            );

            const datatask = listask.data.tasks.map(async (value, index) => {
              if (value.status === "start") {
                const completeTask = await makeRequest(
                  url,
                  JSON.stringify({
                    operationName: "pushTaskAct",
                    query:
                      'mutation pushTaskAct($act: String = \n"", $taskId: uuid = \n"") {\n  pushTaskAct(act: $act, taskId: $taskId)\n}',
                    variables: {
                      act: "start",
                      taskId: value.id,
                    },
                  }),
                  { authorization: `Bearer ${access_token}` },
                  queryContent
                );
                if (completeTask.data.pushTaskAct) {
                  log(
                    `task action ${value.id} status : ${value.status} akun ke [${index}]`,
                    "warning"
                  );
                  await delay(10000);
                  const completeTaskClaim = await makeRequest(
                    url,
                    JSON.stringify({
                      operationName: "pushTaskAct",
                      query:
                        'mutation pushTaskAct($act: String = \n"", $taskId: uuid = \n"") {\n  pushTaskAct(act: $act, taskId: $taskId)\n}',
                      variables: {
                        act: "claim",
                        taskId: value.id,
                      },
                    }),
                    { authorization: `Bearer ${access_token}` },
                    queryContent
                  );
                  if (completeTaskClaim.data.pushTaskAct) {
                    log(
                      `task claim ${value.id} status : ${value.status} akun ke [${index}]`,
                      "warning"
                    );
                  } else {
                    log(
                      `task claim failed ${value.id} status : ${value.status} akun ke [${index}]`,
                      "error"
                    );
                  }
                } else {
                  log(
                    `task action failed ${value.id} status : ${value.status} akun ke [${index}]`,
                    "error"
                  );
                }
              } else {
                const completeTaskClaim = await makeRequest(
                  url,
                  JSON.stringify({
                    operationName: "pushTaskAct",
                    query:
                      'mutation pushTaskAct($act: String = \n"", $taskId: uuid = \n"") {\n  pushTaskAct(act: $act, taskId: $taskId)\n}',
                    variables: {
                      act: "claim",
                      taskId: value.id,
                    },
                  }),
                  { authorization: `Bearer ${access_token}` },
                  queryContent
                );
                if (completeTaskClaim.data.pushTaskAct) {
                  log(
                    `task claim ${value.id} status : ${completeTaskClaim.data.pushTaskAct} akun ke [${index}]`,
                    "warning"
                  );
                } else {
                  log(
                    `task claim failed ${value.id} status : ${completeTaskClaim.data.pushTaskAct} akun ke [${index}]`,
                    "error"
                  );
                }
              }
            });
            await Promise.all(datatask);
            for (let indexx = 0; indexx < accoutt.data.user.turn; indexx++) {
              const playGame = await makeRequest(
                url,
                JSON.stringify({
                  operationName: "requestPlayGame",
                  query:
                    "mutation requestPlayGame {\n  requestPlayGame {\n    gameHistoryId\n    __typename\n  }\n}",
                  variables: {},
                }),
                { authorization: `Bearer ${access_token}` },
                queryContent
              );
              if (playGame.data.requestPlayGame.gameHistoryId) {
                log(
                  `play game  ${playGame.data.requestPlayGame.gameHistoryId} 🎮🎮 akun ke [${index}]`,
                  "warning"
                );
                const dataarray = await payloadGame();
                // console.log(dataarray);
                const payload = await encryptData(dataarray, key);
                // console.log(payload);
                log(`wait 60 sec..`, "warnig");
                // await delay(60000);
                const cekjumlah = await makeRequest(
                  url,
                  JSON.stringify({
                    operationName: "claimGame",
                    query:
                      'mutation claimGame($args: ClaimGameInput = {data: \n"", historyId: \n""}) {\n  claimGame(args: $args)\n}',
                    variables: {
                      args: {
                        data: payload,
                        historyId: playGame.data.requestPlayGame.gameHistoryId,
                      },
                    },
                  }),
                  { authorization: `Bearer ${access_token}` },
                  queryContent
                );
                if (cekjumlah.data.claimGame) {
                  log(
                    `play game  succesfully 🎮🎮 akun ke [${index}]`,
                    "success"
                  );
                } else {
                  log(`play game 🎮🎮 failed !! akun ke [${index}]`, "error");
                }
                const saldoLast = await makeRequest(
                  url,
                  JSON.stringify({
                    operationName: "getMyData",
                    query:
                      'query getMyData($userId: bigint = \n"") {\n  user: userByPk(id: $userId) {\n    ...User\n    __typename\n  }\n}\nfragment User on User {\n  id\n  createdAt\n  balance\n  isAllowPm\n  lastClaimReferralAt\n  referralCode\n  referredByCode\n  turn\n  updatedAt\n  __typename\n}',
                    variables: { userId: parseFloat(id) },
                  }),
                  { authorization: `Bearer ${access_token}` },
                  queryContent
                );
                log(
                  `balance update : ${saldoLast.data.user.balance} akun ke [${index}]`,
                  "custom"
                );
              } else {
                log(` play game 🎮🎮 failed !! akun ke [${index}]`, "error");
              }
            }
          } else {
            log(`get account failed akun ke [${index}]`, "error");
          }
        } else {
          log(`get token failed akun ke [${index}]`, "error");
        }
      } catch (error) {
        log(`failed proses akun ke [${index}] `, "error");
      }
    });

    await Promise.all(promises); // Tunggu sampai semua promise dalam chunk selesai
    log(chalk.blue(`Chunk ${i / chunkSize + 1} completed.`));
    await delay(5000); // Delay 5 detik sebelum memproses chunk berikutnya (opsional)
  }
}
(async () => {
  const queryIds = readQueryIdsFromFile();
  if (queryIds.length === 0) {
    console.error(chalk.red("No query_ids found in query.txt"));
    return;
  }

  while (true) {
    await processChunkedData(queryIds, 20);
    log(`➤ Processing Account Couldown 10 menit !!`, "warning");
    await delay(60000 * 10);
  }
})();
