# gerrit-monitor
Watch for changes in Gerrit patches and send Slack alerts

# Config file parameters
## Required
*gerritUrlBase*: Full URL (protocol, hostname, port); Must not end with '/'; No default.
*gerritUrlSuffix*: The last part of the URL; No default
*gerritUrlPrefix*: What goes right after the *gerritUrlBase*; No default
*dataDir*: Where to store the output files; Default: 'data'
*dataFilename*: Filename; Default: 'Open'
*dataFileExt*: File extension; Default: '.json'
## Optional
*cron.frequency*: Number of seconds between updates; Default: 30
*monitor.gerritRecordCount*: Number of Gerrit records to fetch (max); Default: 100
*monitor.log.filename*: Base filename (appended by Gerrit status name and timestamp); Default: 'snapshot-log'
*saveHistory*: Should previous records be archived? Default: true
