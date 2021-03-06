'use strict';

const { JupiterOneClient } = require('@jupiterone/jupiterone-client-nodejs');
const program = require('commander');
const fs = require('fs');
const pdf = require("markdown-pdf");

const {
  J1_ACCOUNT: account,
  J1_API_TOKEN: accessToken,
} = process.env;

function parseArrayString(text) {
  let output = '';
  if (text) {
    if (Array.isArray(text)) {
      text.forEach(function(item) {
        output += `${item}\n\n`;
      });
    } else {
      output = text;
    }
  }
  return output;
}

async function main() {
  program
    .usage('[options]')
    .option('--assessment <name>', 'The name an assessment entity in J1.')
    .parse(process.argv);

  const j1Client = new JupiterOneClient({ account, accessToken });
  await j1Client.init();

  // Query J1 for the assessment with name provided as input
  const query = `Find Assessment with name='${program.assessment}'`;
  const assessments = await j1Client.queryV1(query);

  for (const a of assessments || []) {
    if (a.entity && a.properties) {
      // Build Markdown string for report overview
      const assessors = Array.isArray(a.properties.assessors)
        ? `\n\n- ${a.properties.assessors.join('\n- ')}`
        : a.properties.assessors;
      const reportOverview =
        `# ${a.entity.displayName}\n\n` +
        `**Assessor(s)**: ${assessors}\n\n` +
        `**Completed On**: ${a.properties.completedOn}\n\n` +
        `## Overview\n\n` +
        `${a.properties.summary ? '### Summary\n\n' + a.properties.summary + '\n\n' : ''}` +
        `${a.properties.description ? '### Description\n\n' + a.properties.description + '\n\n' : ''}` +
        `${a.properties.details ? '### Details\n\n' + a.properties.details + '\n\n' : ''}`;

      // Query J1 for all Findings or Risks identified by the Assessment
      const findingsQuery = `Find (Risk|Finding) that relates to Assessment with name='${program.assessment}'`;
      const findings = await j1Client.queryV1(findingsQuery);
      const reportFindingsTOC = [];
      const reportFindings = [];

      // Build Markdown string with details of each finding
      if (findings && findings.length > 0) {
        reportFindingsTOC.push('## List of Findings\n\n');
        reportFindings.push('## Findings Details\n\n');

        for (const f of findings) {
          if (f.entity && f.properties) {
            const score =
              f.properties.numericSeverity ? `(score: ${f.properties.numericSeverity})` : '';
            const summary =
              f.properties.summary ? `${f.properties.summary}\n\n` : '';
            const steps =
              f.properties.stepsToReproduce
                ? '**Steps to Reproduce:**\n\n' + parseArrayString(f.properties.stepsToReproduce) + '\n\n'
                : '';
            const findingOverview =
              `### ${f.entity.displayName}\n\n` +
              '`' + f.entity._type + '`\n\n' +
              `**Severity**: ${f.properties.severity} ${score}\n\n` +
              `${summary}` +
              `> ${f.properties.description}\n\n` +
              `${steps}`;

            // Other finding details
            const regex = /severity|numericSeverity|summary|description|stepsToReproduce/;
            const findingDetails = [];
            Object.keys(f.properties).forEach(function(key) {
              const match = regex.exec(key);
              if (!match) {
                const value = key.endsWith('On')
                  ? new Date(f.properties[key]).toDateString()
                  : f.properties[key];
                const line = value && value.length > 24 ? '\n\n ' : '';
                findingDetails.push(`- **${key}**:${line} ${value}\n\n`);
              }
            });
            reportFindingsTOC.push(`- ${f.entity.displayName}\n\n`);
            reportFindings.push(findingOverview);
            if (findingDetails.length > 0) {
              reportFindings.push('#### Additional Details\n\n' + findingDetails.join(''));
            }
          }
        }
      }

      // Generate Markdown and PDF files
      const output =
        reportOverview + reportFindingsTOC.join('') + reportFindings.join('');
      const reportFilename = `report-${a.id}`;
      fs.writeFileSync(`./${reportFilename}.md`, output);
      pdf().from(`./${reportFilename}.md`).to(`./${reportFilename}.pdf`, function() {
        console.log(`Created Assessment Report: ${reportFilename}`);
      })
    }
  }
}

main();