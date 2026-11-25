app.get("/all", sendData);

function sendData(req, res) {
  res.send(projectData);
}

// POST route
app.post("/addWeatherData", addWeatherData);

function addWeatherData(req, res) {
  projectData = req.body;
  res.send(projectData);
}
