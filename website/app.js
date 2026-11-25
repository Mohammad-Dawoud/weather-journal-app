// Supply your own OpenWeatherMap key in a private local copy.
const API_KEY = "YOUR_OPENWEATHERMAP_API_KEY";
const baseURL = "https://api.openweathermap.org/data/2.5/weather?zip=";

// Convert date
function convertDate(unixtimestamp) {
  // Months array
  var months_array = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  // Convert timestamp to milliseconds
  var date = new Date(unixtimestamp * 1000);
  var year = date.getFullYear();
  var month = months_array[date.getMonth()];
  var day = date.getDate();
  // Display date time in MM/dd/yyyy format
  var convertedTime = month + "/" + day + "/" + year;

  return convertedTime;
}

// Event listener to add function to existing HTML DOM element
/* Function called by event listener */
document.getElementById("generate").addEventListener("click", displayAction);

function displayAction() {
  const zip = document.getElementById("zip").value;
  const feelings = document.getElementById("feelings").value;

  getDataApi(baseURL, zip, API_KEY)
    .then(function (data) {
      console.log("AllData from api: ", data);
      postDataApi("/addWeatherData", {
        temperature: data.main.temp,
        date: convertDate(data.dt),
        userResponse: feelings,
      });
    })
    .then(() => updateUI());
}

// Async GET
/* GET Web API Data Function*/
const getDataApi = async (baseURL, zip, API_KEY) => {
  if (zip.toString().length !== 5) {
    alert("zip should be of length 5!");
  } else {
    const url = `${baseURL}${zip}${API_KEY}`;

    const request = await fetch(url);
    try {
      const allData = await request.json();
      if (allData.message) {
        alert(allData.message);
      } else {
        return allData;
      }
    } catch (error) {
      console.log("error", error);
      // Error handle
    }
  }
};

/* POST data Function*/
// Async POST
const postDataApi = async (url = "", data = {}) => {
  console.log("post weather data: ", data);
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  try {
    const newData = await response.json();
    console.log("post res: ", newData);
  } catch (error) {
    console.log("error", error);
  }
};

/* Update UI Function */
const updateUI = async () => {
  const request = await fetch("/all");
  try {
    const data = await request.json();
    console.log("updateUI: ", data);
    document.getElementById("date").innerHTML = `Date: ${data.date}`;
    document.getElementById(
      "temp"
    ).innerHTML = `Temperature(°C): ${data.temperature}`;
    document.getElementById(
      "content"
    ).innerHTML = `Feelings: ${data.userResponse}`;
  } catch (error) {
    console.log("error", error);
  }
};
