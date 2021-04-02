const config = require('config')
const fs = require('fs')
const debug = require('debug')('gerrit-monitor')
const cron = require('node-cron')

const DEFAULT_NO_CHANGE_MSG = `No new patches have been merged`
const FULL_TSV_EXTENSION = "-full.tsv"
const FILTERED_TSV_EXTENSION = "-filtered.tsv"

const slackConfigured =
  config.has('slack') &&
  config.slack.has('enabled') &&
  config.slack.enabled &&
  config.slack.has('webhookUrl')
  ? config.slack.webhookUrl
  : false

let slackNotification =
config.has('spotlight') &&
config.spotlight.has('enabled') &&
config.spotlight.enabled &&
config.spotlight.has('notifications') &&
config.spotlight.notifications.has('slack') &&
config.spotlight.notifications.slack.has('enabled') &&
config.spotlight.notifications.slack.enabled &&
config.spotlight.notifications.slack.has('webhookUrl')
  ? config.spotlight.notifications.slack.webhookUrl
  : false

let fileNotification =
  config.has('spotlight') &&
  config.spotlight.has('enabled') &&
  config.spotlight.enabled &&
  config.spotlight.has('notifications') &&
  config.spotlight.notifications.has('file') &&
  config.spotlight.notifications.file.has('enabled') &&
  config.spotlight.notifications.file.enabled &&
  config.spotlight.notifications.file.has('outputFilename')
    ? config.spotlight.notifications.file.outputFilename
    : false

debug(`slackNotification: `, slackNotification)
debug(`fileNotification: `, fileNotification)

let fileNotificationFiltered = false
let fileNotificationFull = false

if (fileNotification) {
  fileNotificationFull = fileNotification + FULL_TSV_EXTENSION
  fileNotificationFiltered = fileNotification + FILTERED_TSV_EXTENSION

  if (!fs.existsSync(fileNotificationFull) || !fs.existsSync(fileNotificationFiltered)) {
    debug(`Couldn't find Full or Filtered files; creating new files...`)
    fs.writeFileSync(
      fileNotificationFull,
      `${[
        `Timestamp`,
        `Add Count`,
        `Add List`,
        `Drop Count`,
        `Drop List`,
        `Merge Count`,
        `Merge List`,
      ].join(`\t`)}\n`
    )
    fs.writeFileSync(
      fileNotificationFiltered,
      `${[
        `Timestamp`,
        `Add Count`,
        `Add List`,
        `Drop Count`,
        `Drop List`,
        `Merge Count`,
        `Merge List`,
      ].join(`\t`)}\n`
    )
  }
  debug(`fileNotification enabled: ${fileNotification}
  Full: ${fileNotificationFull}
  Filtered: ${fileNotificationFiltered}`)
} else {
  debug(`fileNotification not enabled`)
}

if (slackConfigured) {
  const { IncomingWebhook } = require('@slack/webhook')
  let webhook = new IncomingWebhook(slackConfigured)

  const reportEmpty =
    config.has('cron') && config.cron.has('reportEmpty')
      ? config.cron.reportEmpty
      : false

  const DEFAULT_FREQUENCY = 30 // Number of minutes between checks

  const Gerrit = require('./gerrit-lib')
  const gLib = new Gerrit()

  const freq =
    config.has('cron') &&
    config.has('cron.frequency') &&
    typeof config.cron.frequency === 'number'
      ? config.cron.frequency
      : DEFAULT_FREQUENCY

  debug(`freq: ${freq}`)

  cron.schedule(`*/${freq} * * * *`, () => {
    gLib.fetchAndLog().then(async (x) => {
      debug(`done with `, x)
      let result = gLib.delta()

      let d = new Date().toLocaleString('en', { timeZoneName: 'short' })
      debug(`${d} delta result: `, result)
      if (result.count || reportEmpty) {
        if (result.count) {
          if (slackNotification) {
            let msg = `*${result.type} Patch Delta Report* @ ${d}: ${
              reportEmpty ? `\nReporting Empty: yes` : ''
            }${
              (result && result.add && result.add.length) || reportEmpty
                ? `\n:fire: Added: ${result.add.join(',')}`
                : ''
            } ${
              (result && result.drop && result.drop.length) || reportEmpty
                ? `\n:checkered_flag: Dropped: ${result.drop.join(',')}`
                : ''
            }`
            let headerBlock = {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${result.type} Patch Delta Report* @ ${d}`,
              },
            }
            let mergeBlock =
              result.merge && result.merge.length
                ? {
                    type: 'section',
                    text: {
                      type: 'mrkdwn',
                      text: `*Merged*\n${`:checkered_flag:` + result.merge.join('\n:checkered_flag:')}\n`,
                    },
                  }
                : false

            let addBlock =
              result.add && result.add.length
                ? {
                    type: 'section',
                    text: {
                      type: 'mrkdwn',
                      text: `*Added*\n${`:fire:` + result.add.join('\n:fire:')}\n`,
                    },
                  }
                : false

            let dropBlock =
              result.drop && result.drop.length
                ? {
                    type: 'section',
                    text: {
                      type: 'mrkdwn',
                      text: `*Dropped*\n${
                        `:arrow_down:` + result.drop.join('\n:arrow_down:')
                      }\n`,
                    },
                  }
                : false

            if (addBlock || dropBlock || mergeBlock || reportEmpty) {
              blocks = [headerBlock]
              if (addBlock || dropBlock || mergeBlock) {
                if (addBlock) blocks.push(addBlock)
                if (dropBlock) blocks.push(dropBlock)
                if (mergeBlock) blocks.push(mergeBlock)
              } else {
                blocks.push({
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `Nothing added, dropped, or merged\n(Sending empty notification per reportEmpty config value)`,
                  },
                })
              }

              await webhook.send({
                blocks: blocks,
              })
            } // addBlock...reportEmpty
          } // slackNotification

        } else { // result.count is empty, so go ahead and reportEmpty with no results
          if (slackNotification) {
            await webhook.send({ type: `mrkdwn`, text: DEFAULT_NO_CHANGE_MSG })
          }
          debug(`No items added or dropped, so no notification/update`)
        } // result.count
      } // result.count || reportEmpty

      if (fileNotification) {
        updateReportFiles(fileNotification, gLib.latestTimestamp, result)
      }
    })
  })
} else {
  console.error(
    `Either Slack or File notification must be configured and enabled.
    e.g. 'config.slack.enabled = true' and 'config.slack.webhookUrl' must be set`
  )
}

function updateReportFiles(filenameBase, timestamp, result) {
  debug(`updateReportFiles(${filenameBase}, ${timestamp}, result) called...`)
  debug(`...appending ${filenameBase + FULL_TSV_EXTENSION}`)
  fs.appendFileSync(
    filenameBase + FULL_TSV_EXTENSION,
    `${[
      timestamp,
      result.add.length,
      result.add.join(','),
      result.drop.length,
      result.drop.join(','),
      result.merge.length,
      result.merge.join(','),
    ].join('\t')}\n`
    )

  // Print non-zero elements to FILTERED file
  if (result.add.length + result.drop.length + result.merge.length > 0) {
    debug(`...appending ${filenameBase + FILTERED_TSV_EXTENSION}`)
    fs.appendFileSync(
      filenameBase + FILTERED_TSV_EXTENSION,
      `${[
        timestamp,
        result.add.length,
        result.add.join(','),
        result.drop.length,
        result.drop.join(','),
        result.merge.length,
        result.merge.join(','),
      ].join('\t')}\n`
    )
  }
}

function formatUrgent(data, icon = false) {
  const results = ['\n']
  data.forEach((d) => {
    results.push(
      `${icon ? `:${icon}:` : ''}<${config.gerritUrlBase}/${d.id}|${d.id}>: ${
        d.subject
      } (${
        config.has('slack') &&
        config.slack.has('users') &&
        Object.keys(config.slack.users).includes(d.email)
          ? `<@${config.slack.users[d.email]}>`
          : `${d.owner} ${d.email}`
      }; ${d.vScore})`
    )
  })
  return results.join('\n')
}
