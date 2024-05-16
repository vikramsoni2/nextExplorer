const express = require('express');
const fs = require('fs').promises;
const fss = require('fs');
const path = require('path');
const cors = require('cors'); 
const bodyParser = require('body-parser');
const multer = require('multer');
const app = express();// You can choose any port you like
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');

const port = 3000; 
const cacheDir = '/cache'

const corsOptions = {
  origin: '*',
  optionsSuccessStatus: 200,
  methods: ['GET', 'PUT', 'UPDATE', 'DELETE']  
};


app.use(cors(corsOptions));
app.use(bodyParser.json());
 
// const upload = multer({ dest: 'uploads/' })


function CustomStorage(opts) {
  this.getDestination = opts.destination || function (req, file, cb) {
    cb(null, '/uploads/');
  };
}

CustomStorage.prototype._handleFile = function (req, file, cb) {
  this.getDestination(req, file, async (err, destination) => {
    if (err) {
      console.error("Error in getDestination:", err);
      return cb(err);
    }

    const relativePath = path.normalize(req.body.relativePath);
    const uploadTo = path.join("/mnt/", path.normalize(req.body.uploadTo));
    let destinationPath;

    if (relativePath.includes('/')) {
      destinationPath = path.join(uploadTo, relativePath);
    } else {
      destinationPath = path.join(uploadTo, path.basename(relativePath));
    }

    const destinationDir = path.dirname(destinationPath);
    const tempPath = destinationPath + '.download';

    try {
      await fs.mkdir(destinationDir, { recursive: true });
      const outStream = fss.createWriteStream(tempPath);

      file.stream.pipe(outStream);
      outStream.on('error', (streamErr) => {
        console.error("Error during file streaming:", streamErr);
        cb(streamErr);
      });
      outStream.on('finish', async () => {
        try {
          await fs.rename(tempPath, destinationPath);
          cb(null, {
            path: destinationPath,
            size: outStream.bytesWritten
          });
        } catch (renameErr) {
          console.error("Error during file renaming:", renameErr);
          cb(renameErr);
        }
      });
    } catch (err) {
      console.error("Error during file upload:", err);
      cb(err);
    }
  });
};

CustomStorage.prototype._removeFile = function (req, file, cb) {
  fs.unlink(file.path, cb);
};

const customStorage = (opts) => new CustomStorage(opts);

const upload = multer({ storage: customStorage({}) });

app.post('/api/upload', upload.fields([{ name: 'filedata', maxCount: 50 }]), async (req, res) => {
  try {
    for (const file of req.files.filedata) {
      console.log("File uploaded to:", file.path);
    }
    res.send('Files uploaded successfully');
  } catch (err) {
    console.error(`Error: ${err}`);
    res.status(500).send('Server error');
  }
});

// app.post('/api/upload', upload.fields([{ name: 'filedata', maxCount: 50 }]), async function (req, res) {
//   try {
//     for (const file of req.files.filedata) {
//       const relativePath = req.body.relativePath;
//       const uploadTo = path.join("/mnt/", req.body.uploadTo);
//       let destinationPath;

//       if (relativePath.includes('/')) {
//         destinationPath = path.join(uploadTo, relativePath);
//       } else {
//         destinationPath = path.join(uploadTo, path.basename(relativePath));
//       }

//       console.log("file: ", file);
//       console.log("destinationPath: ", destinationPath);

//       const destinationDir = path.dirname(destinationPath);

//       // Ensure the destination directory exists
//       await fs.mkdir(destinationDir, { recursive: true });

//       // Move the file to the destination
//       const tmpPath = file.path;
//       console.log(`moving file from ${tmpPath} to ${destinationPath}`);

//       await fs.copyFile(tmpPath, destinationPath);
//       await fs.unlink(tmpPath);

//       console.log(`File moved to ${destinationPath}`);
//     }

//     res.send('Files uploaded successfully');
//   } catch (err) {
//     console.error(`Error: ${err}`);
//     res.status(500).send('Server error');
//   }
// });



// app.post('/api/upload', upload.fields([{ name: 'filedata', maxCount: 50 }]), function (req, res) {
  
//   req.files.filedata.forEach(file => {
//     const relativePath = req.body.relativePath;
//     const uploadTo = path.join("/mnt/", req.body.uploadTo);
//     let destinationPath;

//     if (relativePath.includes('/')) {
//       destinationPath = path.join(uploadTo, relativePath);
//     } else {
//       destinationPath = path.join(uploadTo, path.basename(relativePath));
//     }

//     console.log("file: ", file)
//     console.log("destinationPath: ", destinationPath)


//     const destinationDir = path.dirname(destinationPath);

//     // Ensure the destination directory exists
//     fs.mkdir(destinationDir, { recursive: true }, (err) => {
//       if (err) {
//         console.error(`Error creating directory: ${err}`);
//         return res.status(500).send('Server error');
//       }

//       // Move the file to the destination
//       const tmpPath = file.path;
//       console.log(`movinf file from ${tmpPath} to ${destinationPath}`)

//       fs.rename(tmpPath, destinationPath, (err) => {
//         if (err) {
//           console.error(`Error moving file: ${err}`);
//           return res.status(500).send('Server error');
//         }

//         console.log(`File moved to ${destinationPath}`);
//       });
//     });
    
//   });

//   res.send('Files uploaded successfully');
    
// });




app.get('/api/volumes', async (req, res) => {
  try {
    const directoryPath = '/mnt/';
    const volumes = await fs.readdir(directoryPath);
    const volumeData = volumes.map((volume) => {
      return {
        name: volume,
        path: volume,
        kind: 'volume',
      };
    });
    res.json(volumeData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An error occurred while fetching the volumes.' });
  }
});



// Function to generate image thumbnail
// async function generateImageThumbnail(filePath, thumbPath) {
//   await sharp(filePath)
//     .resize(200) // Resize to 200px width, maintain aspect ratio
//     .toFile(thumbPath);
// }

async function generateImageThumbnail(filePath) {
  const buffer = await sharp(filePath)
    .resize(200) // Resize to 200px width, maintain aspect ratio
    .toBuffer(); // Convert the image to a buffer

  const base64Image = buffer.toString('base64'); // Convert the buffer to a base64 string
  return `data:image/png;base64,${base64Image}` ;
}


// Function to generate video thumbnail
// async function generateVideoThumbnail(filePath, thumbPath) {
//   return new Promise((resolve, reject) => {
//     ffmpeg(filePath)
//       .screenshots({
//         timestamps: ['50%'], // Capture thumbnail from the middle of the video
//         filename: path.basename(thumbPath),
//         folder: path.dirname(thumbPath),
//         size: '200x?'
//       })
//       .on('end', resolve)
//       .on('error', reject);
//   });
// }


const generateVideoThumbnail = (inputVideoPath) => {
  return new Promise((resolve, reject) => {
    const passThrough = new PassThrough();

    ffmpeg(inputVideoPath)
      .on('end', () => {
        console.log('Thumbnail generated successfully');
      })
      .on('error', (err) => {
        console.error('Error generating thumbnail:', err);
        reject(err);
      })
      .format('image2')
      .size('320x?')
      .frames(1)
      .output(passThrough)
      .run();

    const chunks = [];
    passThrough.on('data', (chunk) => {
      chunks.push(chunk);
    });

    passThrough.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const base64String = `data:image/png;base64,${buffer.toString('base64')}`;
      resolve(base64String);
    });

    passThrough.on('error', (err) => {
      reject(err);
    });
  });
};





// Endpoint to get file information
app.get('/api/browse/*', async (req, res) => {
  const directoryPath = `/mnt/${req.params[0]}`; // Replace with your directory path

  try {
    const files = await fs.readdir(directoryPath);
    const fileData = [];

    // Use Promise.all to read file stats asynchronously
    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(directoryPath, file);
        const stats = await fs.stat(filePath);

        let extension = file.split(".").splice(-1)[0]
        if(extension.length > 10) extension='unknown'

        let item = {
          name: file,
          path: req.params[0], 
          dateModified: stats.mtime,
          size: stats.size,
          kind: extension
        }

        if (stats.isFile()) {

          item.kind = extension

          // const thumbPath = path.join('/mnt/', req.params[0], '.thumbs', `${file}.thumb.jpg`);

          if (['jpg', 'jpeg', 'png', 'gif'].includes(extension.toLowerCase())) {
            // await fs.mkdir(path.join('/mnt/', req.params[0], '.thumbs'), { recursive: true });
            // await generateImageThumbnail(filePath, thumbPath);
            item.thumbnail = await generateImageThumbnail(filePath)
          
          } else if (['mp4', 'avi', 'mov', 'mkv'].includes(extension.toLowerCase())) {
            // await fs.mkdir(path.join('/mnt/', req.params[0], '.thumbs'), { recursive: true });
            // await generateVideoThumbnail(filePath, thumbPath);
            item.thumbnail = await generateVideoThumbnail(filePath)
          }
        }
        else if(stats.isDirectory()){
          item.kind = 'directory'
        }
        fileData.push(item);
      })
    );

    res.json(fileData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An error occurred while reading the directory.' });
  }
});


app.get('/api/file/:path', (req, res) => {
  const filePath = "/mnt/"+req.params.path
  console.log("hitting file endpoint")
  console.log(filePath)

  fs.readFile(filePath, { encoding: 'utf-8' }, (err, data) => {
      if (err) {
          console.error('Error reading the file:', err);
          return res.status(500).send('Failed to read file.');
      }
      res.send(data);
  });
});


app.post('/api/editor', async (req, res) => {
  const basePath = "/mnt";
  const safeFilePath = path.join(basePath, req.body.path.replace(/\.\./g, ''));

  try {
    const data = await fs.readFile(safeFilePath, { encoding: 'utf-8' });
    console.log(data);
    res.send({ content: data });
  } catch (err) {
    console.error('Error reading the file:', err);
    res.status(500).json({ error: 'Failed to read file.' });
  }
});


app.put('/api/editor', (req, res) => {
  const filePath = "/mnt/"+ request.body.path
  const content = req.body.content; // Assuming the new content is passed as a JSON payload

  fs.writeFile(filePath, content, (err) => {
      if (err) {
          console.error('Error writing to the file:', err);
          return res.status(500).send('Failed to update file.');
      }
      res.send('File updated successfully.');
  });
});




app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});
