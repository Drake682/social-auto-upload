import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { plainToClass } from 'class-transformer';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const path = request?.path || request?.url;

    return next.handle().pipe(
      map((data) => {
        if (path === '/health') {
          return data;
        }

        if (data && data.code !== undefined) {
          return data;
        }

        return {
          code: 200,
          data,
          msg: 'Success',
        };
      }),
    );
  }
}
