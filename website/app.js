const form = document.getElementById("journalForm");
const zipField = document.getElementById("zip");
const feelingsField = document.getElementById("feelings");
const generate = document.getElementById("generate");
const statusLine = document.getElementById("status");
const emptyEntry = document.getElementById("emptyEntry");
const entryHolder = document.getElementById("entryHolder");
let saving = false;
const live = document.documentElement.dataset.weatherMode === "live";

const messages = {
  unknown_zip: live
    ? "OpenWeather could not find this US ZIP code."
    : "No fixture weather is available for this ZIP.",
  invalid_input:
    "Enter a five-digit US ZIP and a sample note up to 500 characters.",
  session_required: "Your session expired. Submit again to save this entry.",
  session_capacity:
    "The journal is at capacity. Try again after a session expires.",
  save_in_progress: "A save is already in progress for this session.",
  weather_timeout: "The weather lookup timed out. Try again.",
  weather_unavailable: live
    ? "Live weather is temporarily unavailable."
    : "Fixture weather is temporarily unavailable.",
  weather_credentials:
    "OpenWeather denied access. Check the server key and plan before restarting live mode.",
  weather_rate_limited:
    "The live weather request limit was reached. Try again later.",
  weather_busy: "Live weather is busy. Wait for another lookup to finish.",
};

function showStatus(message, error = false) {
  statusLine.textContent = message;
  statusLine.toggleAttribute("data-error", error);
}

async function readResponse(response) {
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      Object.hasOwn(messages, result.error) ? result.error : "request_failed",
    );
  }
  return result;
}

async function postDataApi(url, data) {
  return readResponse(
    await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  );
}

async function updateUI() {
  const { entry } = await readResponse(
    await fetch("/all", { credentials: "same-origin", cache: "no-store" }),
  );
  emptyEntry.hidden = entry !== null;
  entryHolder.hidden = entry === null;
  if (entry !== null) {
    document.getElementById("date").textContent = `Date (UTC): ${entry.date}`;
    document.getElementById("temp").textContent =
      `Temperature: ${entry.temperatureF} °F`;
    document.getElementById("content").textContent =
      `Feelings: ${entry.feelings}`;
  } else {
    for (const field of entryHolder.children) {
      field.textContent = "";
    }
  }
}

async function displayAction(event) {
  event.preventDefault();
  if (saving || !form.reportValidity()) {
    return;
  }

  const zip = zipField.value;
  const feelings = feelingsField.value.trim();
  if (!feelings) {
    showStatus(messages.invalid_input, true);
    feelingsField.focus();
    return;
  }

  saving = true;
  generate.disabled = true;
  showStatus("Saving entry…");
  let saved = false;
  try {
    await postDataApi("/addWeatherData", { zip, feelings });
    saved = true;
    await updateUI();
    showStatus("Entry saved.");
  } catch (error) {
    if (saved) {
      showStatus(
        "Entry saved, but the latest entry could not load. Refresh to view it.",
        true,
      );
    } else if (error.message === "session_required") {
      try {
        await updateUI();
        showStatus(messages.session_required, true);
      } catch {
        showStatus(
          "Could not renew the journal session. Refresh and try again.",
          true,
        );
      }
    } else {
      showStatus(
        Object.hasOwn(messages, error.message)
          ? messages[error.message]
          : "Could not save the entry. Please try again.",
        true,
      );
    }
  } finally {
    saving = false;
    generate.disabled = false;
  }
}

generate.addEventListener("click", displayAction);
form.addEventListener("submit", displayAction);
updateUI()
  .catch(() =>
    showStatus("Could not load the journal. Refresh to try again.", true),
  )
  .finally(() => {
    generate.disabled = false;
  });
