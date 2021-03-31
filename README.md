# gerrit-monitor

# What it does
Queries Gerrit for patch changes and (optionally) sends Slack alerts.

# How it works
1. On a regular schedule, pulls a list of the latest patches in Gerrit (parameters are set in the config file; see below for the available options)
   1. Specific Gerrit flags/filters can be applied, including hashtags (spotlight.flags.hashtag in the config file), to limit the number of items covered in the delta report.
1. Calculates the delta from the prior report
1. If there are differences, reports on the delta.
   1. If enabled, a Slack message is sent with summary data (patch owner, status, and, if open, reviewers)

# Optional
## Slack
If you want to send Slack messages, create a custom webhook and save it under *slack.webhookUrl* (See below for details).

### Slack setup
1. Create a new webhook at https://api.slack.com/apps/new (Optional)
2. Update the config file with the slack.webhookUrl value

# Config file parameters
## Required

- *gerritUrlBase*: Full URL (protocol, hostname, port); Must not end with '/'; No default.
- *gerritUrlSuffix*: The last part of the URL; No default
- *gerritUrlPrefix*: What goes right after the *gerritUrlBase*; No default
- *dataDir*: Where to store the output files; Default: 'data'
- *dataFilename*: Filename; Default: 'Open'
- *dataFileExt*: File extension; Default: '.json'
## Optional

- *cron.frequency*: Number of seconds between updates; Default: 30
- *gerritConfig.username*: Authentication option - username
- *gerritConfig.password*: Authentication option - password
- *monitor.gerritRecordCount*: Number of Gerrit records to fetch (max); Default: 100
- *monitor.log.filename*: Base filename (appended by Gerrit status name and timestamp); Default: 'snapshot-log'
- *saveHistory*: Should previous records be archived? Default: true
- *slack.webhookUrl*: Webhook from Slack (required if you want to send Slack messages)