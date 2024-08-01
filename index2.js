const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { WebClient } = require('@slack/web-api');
require('dotenv').config();

const app = express();
const slackToken = process.env.SLACK_TOKEN;
const slackClient = new WebClient(slackToken);
const secretKey = Buffer.from(process.env.SECRET_KEY, 'base64');
const baseUrl = 'https://5a62-96-246-210-200.ngrok-free.app';

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

// Endpoint to handle dialog submission
app.post('/interactive-endpoint', async (req, res) => {
  const payload = JSON.parse(req.body.payload);

  if (payload.type === 'view_submission') {
    const secretText = payload.view.state.values.secret_input.secret_text.value;
    const userId = payload.user.id;

    const encryptedSecret = encrypt(secretText, secretKey);
    const secretLink = `${baseUrl}/reveal-secret?iv=${encryptedSecret.iv}&content=${encryptedSecret.content}`;

    try {
      await slackClient.chat.postMessage({
        channel: userId,
        text: `Share this link with the recipient to reveal the secret: ${secretLink}`,
      });
      res.send('');
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).send('Failed to send message');
    }
  }
});

// Endpoint to handle secret retrieval via a button in Slack
app.get('/reveal-secret', async (req, res) => {
  const { iv, content, user_id } = req.query;
  if (!iv || !content) {
    return res.status(400).send('Invalid link');
  }

  const buttonPayload = {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Click the button to reveal the secret.'
        },
        accessory: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Reveal Secret'
          },
          action_id: 'reveal_secret',
          value: JSON.stringify({ iv, content, user_id })
        }
      }
    ]
  };

  res.json(buttonPayload);
});

// Endpoint to handle the button click
app.post('/slack/actions', async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  const action = payload.actions[0];
  
  if (action.action_id === 'reveal_secret') {
    const { iv, content, user_id } = JSON.parse(action.value);
    
    try {
      const decryptedSecret = decrypt({ iv, content }, secretKey);
      
      await slackClient.chat.postMessage({
        channel: user_id,
        text: `The secret is: ${decryptedSecret}`
      });

      res.send('');
    } catch (error) {
      console.error('Error revealing secret:', error);
      res.status(500).send('Failed to reveal secret');
    }
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
