const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { WebClient } = require('@slack/web-api');
require('dotenv').config();

const app = express();
const slackToken = process.env.SLACK_TOKEN;
const slackClient = new WebClient(slackToken);
const secretKey = Buffer.from(process.env.SECRET_KEY, 'base64');

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const encrypt = (text, secretKey) => {
  const algorithm = 'aes-256-ctr';
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);

  return {
    iv: iv.toString('hex'),
    content: encrypted.toString('hex')
  };
};

const decrypt = (hash, secretKey) => {
  const algorithm = 'aes-256-ctr';
  const iv = Buffer.from(hash.iv, 'hex');
  const encryptedText = Buffer.from(hash.content, 'hex');

  const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);
  const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);

  return decrypted.toString();
};

// Slash command endpoint to open the dialog
app.post('/commands/share-secret', async (req, res) => {
  const triggerId = req.body.trigger_id;

  const view = {
    type: 'modal',
    callback_id: 'submit-secret',
    title: {
      type: 'plain_text',
      text: 'Share a Secret'
    },
    blocks: [
      {
        type: 'input',
        block_id: 'secret_input',
        label: {
          type: 'plain_text',
          text: 'Secret'
        },
        element: {
          type: 'plain_text_input',
          action_id: 'secret_text',
          multiline: true
        }
      },
      {
        type: 'input',
        block_id: 'user_select',
        label: {
          type: 'plain_text',
          text: 'Select a user to share with'
        },
        element: {
          type: 'users_select',
          action_id: 'selected_user'
        }
      }
    ],
    submit: {
      type: 'plain_text',
      text: 'Submit'
    }
  };

  try {
    const result = await slackClient.views.open({
      trigger_id: triggerId,
      view: view
    });
    console.log('Modal opened:', result);
    res.send('');
  } catch (error) {
    console.error('Error opening modal:', error);
    res.status(500).send('Failed to open modal');
  }
});

// Unified interactive endpoint to handle both dialog submissions and button clicks
app.post('/interactive-endpoint', async (req, res) => {
  const payload = JSON.parse(req.body.payload);

  if (payload.type === 'view_submission' && payload.view.callback_id === 'submit-secret') {
    // Handle dialog submission
    const secretText = payload.view.state.values.secret_input.secret_text.value;
    const userId = payload.user.id;
    const selectedUserId = payload.view.state.values.user_select.selected_user.selected_user;

    const encryptedSecret = encrypt(secretText, secretKey);

    try {
      await slackClient.chat.postMessage({
        channel: selectedUserId,
        text: 'You have received a secret. Click the button below to reveal it.',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'You have received a secret. Click the button below to reveal it.'
            },
            accessory: {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Reveal Secret'
              },
              action_id: 'reveal_secret',
              value: JSON.stringify({ iv: encryptedSecret.iv, content: encryptedSecret.content })
            }
          }
        ]
      });
      res.send('');
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).send('Failed to send message');
    }
  } else if (payload.type === 'block_actions' && payload.actions[0].action_id === 'reveal_secret') {
    // Handle button click
    res.status(200).send(''); // Respond immediately to avoid timeout

    const { iv, content } = JSON.parse(payload.actions[0].value);
    const triggerId = payload.trigger_id;

    try {
      const decryptedSecret = decrypt({ iv, content }, secretKey);

      await slackClient.views.open({
        trigger_id: triggerId,
        view: {
          type: 'modal',
          callback_id: 'reveal-secret-modal',
          title: {
            type: 'plain_text',
            text: 'Revealed Secret'
          },
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `The secret is: ${decryptedSecret}`
              }
            }
          ]
        }
      });
    } catch (error) {
      console.error('Error revealing secret:', error);
    }
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
