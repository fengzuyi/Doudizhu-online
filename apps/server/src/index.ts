import { createGameServer } from "./createGameServer.js";

const port = Number(process.env.PORT ?? 3001);
const { httpServer } = createGameServer();

httpServer.listen(port, () => {
  console.log(`Dou Dizhu server listening on http://localhost:${port}`);
});
