import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiGatewayTimeoutResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { ObjectId } from 'mongodb';
import {
  COUNTRY_CODE_HEADER,
  IDEMPOTENCY_KEY_HEADER,
} from '../../common/constants/headers.constants.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequestHeaders } from '../../common/decorators/request-headers.decorator.js';
import { API_KEY_SECURITY_NAME } from '../../swagger-conf.js';
import type {
  ICreatedValidation,
  IValidationResponse,
} from '../interfaces/validation.interface.js';
import {
  type CreateValidationBody,
  createValidationSchema,
} from '../schemas/create-validation.schema.js';
import {
  type CreateValidationHeaders,
  createValidationHeadersSchema,
} from '../schemas/create-validation-headers.schema.js';
import { validationIdSchema } from '../schemas/validation-id.schema.js';
import { ValidationsService } from '../services/validations.service.js';
import { SWCONF_VALIDATIONS as SWAGGER } from '../swagger/validations.swagger.js';

@ApiTags(SWAGGER.tag)
@ApiSecurity(API_KEY_SECURITY_NAME)
@Controller('validations')
export class ValidationsController {
  constructor(private readonly validations: ValidationsService) {}

  @Post()
  @ApiOperation(SWAGGER.create.operation)
  @ApiHeader(SWAGGER.headers.countryCode)
  @ApiHeader(SWAGGER.headers.idempotencyKey)
  @ApiBody(SWAGGER.create.body)
  @ApiCreatedResponse(SWAGGER.create.createdResponse)
  @ApiBadRequestResponse(SWAGGER.create.badRequest)
  @ApiUnauthorizedResponse(SWAGGER.create.unauthorized)
  @ApiConflictResponse(SWAGGER.create.conflict)
  @ApiBadGatewayResponse(SWAGGER.create.badGateway)
  @ApiServiceUnavailableResponse(SWAGGER.create.serviceUnavailable)
  @ApiGatewayTimeoutResponse(SWAGGER.create.gatewayTimeout)
  create(
    @RequestHeaders(new ZodValidationPipe(createValidationHeadersSchema))
    headers: CreateValidationHeaders,
    @Body(new ZodValidationPipe(createValidationSchema))
    body: CreateValidationBody,
  ): Promise<ICreatedValidation> {
    return this.validations.create({
      countryCode: headers[COUNTRY_CODE_HEADER],
      name: body.name,
      documentNumber: body.documentNumber,
      idempotencyKey: headers[IDEMPOTENCY_KEY_HEADER],
    });
  }

  @Get(':id')
  @ApiOperation(SWAGGER.get.operation)
  @ApiParam(SWAGGER.get.params.id)
  @ApiOkResponse(SWAGGER.get.okResponse)
  @ApiBadRequestResponse(SWAGGER.get.badRequest)
  @ApiUnauthorizedResponse(SWAGGER.get.unauthorized)
  @ApiNotFoundResponse(SWAGGER.get.notFound)
  findById(
    @Param('id', new ZodValidationPipe(validationIdSchema)) id: ObjectId,
  ): Promise<IValidationResponse> {
    return this.validations.findById(id);
  }
}
