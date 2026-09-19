// test-receiver.js
const express = require("express");
const app = express();
app.use(express.json());
app.post("/webhook", (req, res) => {
  console.log("Header:", req.headers["x-webhook-secret"]);
  console.log("Body:", req.body);
  res.sendStatus(200);
});
app.listen(4000, () => console.log("Listening on :4000"));
