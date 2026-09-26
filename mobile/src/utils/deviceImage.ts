import type { ImageSourcePropType } from 'react-native';
import type { Device } from '../types/device';
export function getDeviceImageSource(device: Device): ImageSourcePropType | undefined {
 const uri=device.annotated_image_url||device.image_url;
 return uri?{uri}:undefined;
}
export const getDetectionImageSource=getDeviceImageSource;
